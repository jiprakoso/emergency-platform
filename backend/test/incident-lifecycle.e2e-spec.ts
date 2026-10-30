import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  CITIZEN_DEVICE,
  createTestApp,
  expectErrorEnvelope,
  Http,
  resetLocalRateLimits,
  resetReportRateLimits,
  staffLogin,
  userIdOf,
} from './e2e-utils';

/**
 * Gerbang Fase 2: mesin status incident lewat HTTP, kunci atomik + perpanjangan +
 * override, `version`/`VERSION_CONFLICT`, S6 (bagian lock & version), merge
 * memindahkan laporan, akun nonaktif ditolak (S7). Dispatch = fixture DB (Fase 3).
 */
describe('Incident: siklus hidup, kunci, version (S6)', () => {
  let app: INestApplication;
  let http: Http;
  let db: DataSource;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let citizen: string;
  let dispatcher: string;
  let dispatcher2: string;
  let supervisor: string;
  let responder: string;
  let orgIds: Record<string, string>;

  async function newIncident(typeCode = 'TRAFFIC_ACCIDENT'): Promise<{ incidentId: string; reportId: string }> {
    await resetReportRateLimits(app, userIdOf(citizen));
    const res = await http
      .post('/api/v1/reports')
      .set(auth(citizen))
      .send({
        clientReportId: randomUUID(),
        reportKind: 'HELP_REQUEST',
        typeCode,
        location: { lat: -7.27, lng: 112.7 },
        description: 'uji siklus',
      });
    expect(res.status).toBe(201);
    return { incidentId: res.body.data.incident.id, reportId: res.body.data.id };
  }

  const lock = (id: string, token = dispatcher, body: object = {}) =>
    http.post(`/api/v1/incidents/${id}/lock`).set(auth(token)).send(body);
  const act = (id: string, action: string, body: object, token = dispatcher) =>
    http.post(`/api/v1/incidents/${id}/${action}`).set(auth(token)).send(body);
  const versionOf = async (id: string) =>
    Number((await db.query(`SELECT version FROM incidents WHERE id = $1`, [id]))[0].version);
  const statusOf = async (id: string) =>
    (await db.query(`SELECT status FROM incidents WHERE id = $1`, [id]))[0].status as string;

  async function verified(): Promise<string> {
    const { incidentId } = await newIncident();
    expect((await lock(incidentId)).status).toBe(200);
    expect((await act(incidentId, 'verify', { version: 1, severity: 'HIGH' })).status).toBe(200);
    return incidentId;
  }

  async function addDispatch(incidentId: string, orgCode: string, status: string, type = 'RESPOND') {
    await db.query(
      `INSERT INTO dispatches (incident_id, organization_id, type, origin, status, recorded_by)
       VALUES ($1, $2, $3, 'DISPATCHER', $4, $5)`,
      [incidentId, orgIds[orgCode], type, status, userIdOf(dispatcher)],
    );
  }

  beforeAll(async () => {
    ({ app, http } = await createTestApp());
    db = app.get(DataSource);
    await resetLocalRateLimits(app);
    const phone = `0897-${String(Date.now()).slice(-4)}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    await http.post('/api/v1/auth/otp/request').send({ phone, purpose: 'REGISTER' });
    citizen = (
      await http.post('/api/v1/auth/citizen/register').send({ phone, otpCode: '123456', fullName: 'Warga Siklus', device: CITIZEN_DEVICE })
    ).body.data.accessToken;
    dispatcher = (await staffLogin(http, 'dispatcher1@contoh.test')).accessToken;
    dispatcher2 = (await staffLogin(http, 'dispatcher2@contoh.test')).accessToken;
    supervisor = (await staffLogin(http, 'supervisor@contoh.test')).accessToken;
    responder = (await staffLogin(http, 'resp.amb1@contoh.test')).accessToken;
    const rows: Array<{ code: string; id: string }> = await db.query(`SELECT code, id FROM organizations`);
    orgIds = Object.fromEntries(rows.map((r) => [r.code, r.id]));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('kunci (S6) atomik, perpanjangan, override', () => {
    it('dua dispatcher mengunci bersamaan → satu 200, satu 409 INCIDENT_LOCKED', async () => {
      const { incidentId } = await newIncident();
      const res = await Promise.all([lock(incidentId, dispatcher), lock(incidentId, dispatcher2)]);
      expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
      expectErrorEnvelope(res.find((r) => r.status === 409)!, 'INCIDENT_LOCKED', 409);
    });

    it('mengunci tidak menaikkan version (version yang dibaca sebelum mengunci tetap berlaku)', async () => {
      const { incidentId } = await newIncident();
      const before = (await http.get(`/api/v1/incidents/${incidentId}`).set(auth(dispatcher))).body.data.version;
      expect((await lock(incidentId)).status).toBe(200);
      expect((await http.post(`/api/v1/incidents/${incidentId}/lock/renew`).set(auth(dispatcher))).status).toBe(200);
      expect(await versionOf(incidentId)).toBe(before);
      expect((await act(incidentId, 'verify', { version: before, severity: 'LOW' })).status).toBe(200);
    });

    it('kunci kedaluwarsa: aksi → LOCK_REQUIRED, renew → LOCK_REQUIRED, dispatcher lain boleh mengambil', async () => {
      const { incidentId } = await newIncident();
      await lock(incidentId);
      await db.query(`UPDATE incidents SET lock_expires_at = now() - interval '1 minute' WHERE id = $1`, [incidentId]);
      expectErrorEnvelope(await act(incidentId, 'verify', { version: 1, severity: 'LOW' }), 'LOCK_REQUIRED', 409);
      expectErrorEnvelope(await http.post(`/api/v1/incidents/${incidentId}/lock/renew`).set(auth(dispatcher)), 'LOCK_REQUIRED', 409);
      expect((await lock(incidentId, dispatcher2)).status).toBe(200);
    });

    it('renew memperpanjang expiresAt pemegang', async () => {
      const { incidentId } = await newIncident();
      await lock(incidentId);
      await db.query(`UPDATE incidents SET lock_expires_at = now() + interval '10 seconds' WHERE id = $1`, [incidentId]);
      const res = await http.post(`/api/v1/incidents/${incidentId}/lock/renew`).set(auth(dispatcher));
      expect(res.status).toBe(200);
      expect(new Date(res.body.data.expiresAt).getTime() - Date.now()).toBeGreaterThan(60_000);
    });

    it('lepas kunci: orang lain tanpa override 403; supervisor 204 + audit; tidak terkunci → 204', async () => {
      const { incidentId } = await newIncident();
      await lock(incidentId);
      expectErrorEnvelope(await http.delete(`/api/v1/incidents/${incidentId}/lock`).set(auth(dispatcher2)), 'FORBIDDEN', 403);
      expect((await http.delete(`/api/v1/incidents/${incidentId}/lock`).set(auth(supervisor))).status).toBe(204);
      const audit = await db.query(`SELECT 1 FROM audit_logs WHERE action = 'incident.lock_override' AND entity_id = $1`, [incidentId]);
      expect(audit).toHaveLength(1);
      expect((await http.delete(`/api/v1/incidents/${incidentId}/lock`).set(auth(dispatcher))).status).toBe(204);
    });
  });

  describe('version & validasi badan', () => {
    it('tanpa version → 400; version usang → 409 VERSION_CONFLICT + currentVersion', async () => {
      const { incidentId } = await newIncident();
      await lock(incidentId);
      expectErrorEnvelope(await act(incidentId, 'verify', { severity: 'LOW' }), 'VALIDATION_FAILED', 400);
      const stale = await act(incidentId, 'verify', { version: 7, severity: 'LOW' });
      expectErrorEnvelope(stale, 'VERSION_CONFLICT', 409);
      expect(stale.body.error.currentVersion).toBe(1);
    });

    it('S6: dua PATCH severity bersamaan dengan version sama → satu 200, satu 409 VERSION_CONFLICT', async () => {
      const id = await verified();
      const v = await versionOf(id);
      const res = await Promise.all(
        ['MEDIUM', 'MASS'].map((severity) => http.patch(`/api/v1/incidents/${id}`).set(auth(dispatcher)).send({ version: v, severity })),
      );
      expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(res.find((r) => r.status === 409)!.body.error.code).toBe('VERSION_CONFLICT');
      expect(await versionOf(id)).toBe(v + 1);
    });

    it('PATCH typeCode tidak dikenal → 400; lokasi tersimpan sebagai (lng,lat)', async () => {
      const id = await verified();
      const v = await versionOf(id);
      expectErrorEnvelope(await http.patch(`/api/v1/incidents/${id}`).set(auth(dispatcher)).send({ version: v, typeCode: 'TIDAK_ADA' }), 'VALIDATION_FAILED', 400);
      const ok = await http.patch(`/api/v1/incidents/${id}`).set(auth(dispatcher)).send({ version: v, location: { lat: -7.3, lng: 112.75 } });
      expect(ok.status).toBe(200);
      const [p] = await db.query(`SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM incidents WHERE id = $1`, [id]);
      expect({ lat: Number(p.lat), lng: Number(p.lng) }).toEqual({ lat: -7.3, lng: 112.75 });
    });
  });

  describe('transisi status lewat HTTP (REST §6.1)', () => {
    it('verify: lead otomatis dari jenis kejadian (kecelakaan → POLICE, kebakaran → FIRE)', async () => {
      const id = await verified();
      const [row] = await db.query(`SELECT lead_organization_id FROM incidents WHERE id = $1`, [id]);
      expect(row.lead_organization_id).toBe(orgIds.POLRES);

      const { incidentId: fire } = await newIncident('FIRE');
      await lock(fire);
      const res = await act(fire, 'verify', { version: 1, severity: 'HIGH' });
      expect(res.body.data.leadOrganization.id).toBe(orgIds.DAMKAR);
    });

    it('verify dengan lead organisasi tak dikenal → 400', async () => {
      const { incidentId } = await newIncident();
      await lock(incidentId);
      expectErrorEnvelope(await act(incidentId, 'verify', { version: 1, severity: 'LOW', leadOrganizationId: randomUUID() }), 'VALIDATION_FAILED', 400);
    });

    it('verify dua kali → 409 INVALID_STATUS_TRANSITION', async () => {
      const id = await verified();
      expectErrorEnvelope(await act(id, 'verify', { version: await versionOf(id), severity: 'LOW' }), 'INVALID_STATUS_TRANSITION', 409);
    });

    it('invalidate dari VERIFIED diizinkan; reputasi pelapor turun; setelah INVALID tidak bisa resolve', async () => {
      const id = await verified();
      const [before] = await db.query(`SELECT reputation_score FROM users WHERE id = $1`, [userIdOf(citizen)]);
      const res = await act(id, 'invalidate', { version: await versionOf(id), reason: 'tidak ditemukan' });
      expect(res.status).toBe(200);
      const [after] = await db.query(`SELECT reputation_score FROM users WHERE id = $1`, [userIdOf(citizen)]);
      expect(after.reputation_score).toBe(before.reputation_score - 1);
      expectErrorEnvelope(await act(id, 'resolve', { version: await versionOf(id) }), 'INVALID_STATUS_TRANSITION', 409);
    });

    it('close langsung dari VERIFIED → 409; resolve → close → PATCH/lead ditolak', async () => {
      const id = await verified();
      expectErrorEnvelope(await act(id, 'close', { version: await versionOf(id) }), 'INVALID_STATUS_TRANSITION', 409);
      expect((await act(id, 'resolve', { version: await versionOf(id) })).status).toBe(200);
      expect((await act(id, 'close', { version: await versionOf(id) })).status).toBe(200);
      expect(await statusOf(id)).toBe('CLOSED');
      expectErrorEnvelope(
        await http.patch(`/api/v1/incidents/${id}`).set(auth(dispatcher)).send({ version: await versionOf(id), severity: 'LOW' }),
        'INVALID_STATUS_TRANSITION',
        409,
      );
      expectErrorEnvelope(
        await http.put(`/api/v1/incidents/${id}/lead`).set(auth(dispatcher)).send({ organizationId: orgIds.BPBD, reason: 'x' }),
        'INVALID_STATUS_TRANSITION',
        409,
      );
    });

    it('resolve dengan dispatch aktif → 409 ACTIVE_DISPATCHES_EXIST; forceCloseDispatches → dispatch ditutup sah', async () => {
      const id = await verified();
      await addDispatch(id, 'AMBULANS', 'EN_ROUTE');
      await addDispatch(id, 'POLRES', 'ON_SCENE');
      await addDispatch(id, 'RSUD', 'READY', 'NOTIFY');
      expectErrorEnvelope(await act(id, 'resolve', { version: await versionOf(id) }), 'ACTIVE_DISPATCHES_EXIST', 409);
      expect((await act(id, 'resolve', { version: await versionOf(id), forceCloseDispatches: true })).status).toBe(200);
      const rows: Array<{ code: string; status: string }> = await db.query(
        `SELECT o.code, d.status FROM dispatches d JOIN organizations o ON o.id = d.organization_id WHERE d.incident_id = $1 ORDER BY o.code`,
        [id],
      );
      expect(rows).toEqual([
        { code: 'AMBULANS', status: 'CANCELLED' },
        { code: 'POLRES', status: 'DONE' },
        { code: 'RSUD', status: 'CANCELLED' },
      ]);
    });

    it('tanpa kunci: resolve dan set lead → 409 LOCK_REQUIRED', async () => {
      const id = await verified();
      await http.delete(`/api/v1/incidents/${id}/lock`).set(auth(dispatcher));
      expectErrorEnvelope(await act(id, 'resolve', { version: await versionOf(id) }), 'LOCK_REQUIRED', 409);
      expectErrorEnvelope(
        await http.put(`/api/v1/incidents/${id}/lead`).set(auth(dispatcher)).send({ organizationId: orgIds.BPBD, reason: 'x' }),
        'LOCK_REQUIRED',
        409,
      );
    });
  });

  describe('merge', () => {
    it('memindahkan laporan + lampiran, report_count dan version tujuan diperbarui', async () => {
      const source = await newIncident();
      const target = await newIncident();
      await db.query(
        `INSERT INTO attachments (incident_id, report_id, uploaded_by, kind, status, storage_key, mime_type)
         VALUES ($1, $2, $3, 'IMAGE', 'CONFIRMED', 'uji/merge.jpg', 'image/jpeg')`,
        [source.incidentId, source.reportId, userIdOf(citizen)],
      );
      await lock(source.incidentId);
      const res = await act(source.incidentId, 'merge', { version: 1, targetIncidentId: target.incidentId });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('DUPLICATE');

      const [report] = await db.query(`SELECT incident_id FROM incident_reports WHERE id = $1`, [source.reportId]);
      expect(report.incident_id).toBe(target.incidentId);
      const [att] = await db.query(`SELECT incident_id FROM attachments WHERE report_id = $1`, [source.reportId]);
      expect(att.incident_id).toBe(target.incidentId);
      const [t] = await db.query(`SELECT report_count, version FROM incidents WHERE id = $1`, [target.incidentId]);
      expect(t).toEqual({ report_count: 2, version: 2 });
      // Laporan warga mengikuti incident induk.
      const mine = await http.get(`/api/v1/reports/${source.reportId}`).set(auth(citizen));
      expect(mine.body.data.incident.id).toBe(target.incidentId);
    });

    it('ke diri sendiri → 400; tujuan tak ada → 404; tujuan tidak aktif → 409; sumber DUPLICATE → 409', async () => {
      const a = await newIncident();
      const b = await newIncident();
      await lock(a.incidentId);
      expectErrorEnvelope(await act(a.incidentId, 'merge', { version: 1, targetIncidentId: a.incidentId }), 'VALIDATION_FAILED', 400);
      expectErrorEnvelope(await act(a.incidentId, 'merge', { version: 1, targetIncidentId: randomUUID() }), 'NOT_FOUND', 404);

      await lock(b.incidentId);
      expect((await act(b.incidentId, 'invalidate', { version: 1, reason: 'x' })).status).toBe(200);
      expectErrorEnvelope(await act(a.incidentId, 'merge', { version: 1, targetIncidentId: b.incidentId }), 'INVALID_STATUS_TRANSITION', 409);

      const c = await newIncident();
      expect((await act(a.incidentId, 'merge', { version: 1, targetIncidentId: c.incidentId })).status).toBe(200);
      const d = await newIncident();
      expectErrorEnvelope(await act(a.incidentId, 'merge', { version: 2, targetIncidentId: d.incidentId }), 'INVALID_STATUS_TRANSITION', 409);
    });
  });

  describe('korban', () => {
    it('setiap pembaruan menambah baris riwayat; responder terkait tanpa kunci; tak terkait → 404', async () => {
      const id = await verified();
      const body = { injured: 2, deceased: 0, critical: 1 };
      expect((await act(id, 'casualties', body)).status).toBe(201);
      expectErrorEnvelope(await act(id, 'casualties', body, responder), 'NOT_FOUND', 404);
      await addDispatch(id, 'AMBULANS', 'ACCEPTED');
      expect((await act(id, 'casualties', { ...body, injured: 3 }, responder)).status).toBe(201);
      const rows = await db.query(`SELECT injured_count FROM incident_casualties WHERE incident_id = $1 ORDER BY reported_at`, [id]);
      expect(rows.map((r: { injured_count: number }) => r.injured_count)).toEqual([2, 3]);
      expectErrorEnvelope(await act(id, 'casualties', { injured: -1, deceased: 0 }), 'VALIDATION_FAILED', 400);
    });
  });

  describe('akun nonaktif (S7)', () => {
    it('access token yang masih berlaku ditolak setelah akun dinonaktifkan', async () => {
      const token = (await staffLogin(http, 'resp.amb3@contoh.test')).accessToken;
      const id = userIdOf(token);
      expect((await http.get('/api/v1/me').set(auth(token))).status).toBe(200);
      try {
        await db.query(`UPDATE users SET status = 'DEACTIVATED' WHERE id = $1`, [id]);
        expectErrorEnvelope(await http.get('/api/v1/me').set(auth(token)), 'ACCOUNT_DEACTIVATED', 403);
      } finally {
        await db.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [id]);
      }
      expect((await http.get('/api/v1/me').set(auth(token))).status).toBe(200);
    });
  });
});
