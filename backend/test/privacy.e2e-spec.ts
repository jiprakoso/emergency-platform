import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  CITIZEN_DEVICE,
  createTestApp,
  expectErrorEnvelope,
  Http,
  resetLocalRateLimits,
  staffLogin,
} from './e2e-utils';

/**
 * S7 (REST §10) + akses incident per audiens + audit wajib (REST §9) untuk Fase 2.
 * Dispatch belum punya endpoint (Fase 3), jadi relasi responder disiapkan
 * langsung di DB uji sebagai fixture.
 */
describe('Privasi & akses (S7) + audit', () => {
  let app: INestApplication;
  let http: Http;
  let db: DataSource;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const DESCRIPTION = 'Pengendara motor tidak sadar (rahasia-uji)';
  const LOCATION = { lat: -7.2711, lng: 112.7013 };

  let citizenA: { token: string; phone: string; fullName: string };
  let citizenB: { token: string };
  let dispatcher: string;
  let dispatcher2: string;
  let supervisor: string;
  let responder: string;
  let responderOrgId: string;
  let reportId: string;
  let incidentId: string;

  async function registerCitizen(fullName: string) {
    const phone = `0899-${String(Date.now()).slice(-4)}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    const otp = await http.post('/api/v1/auth/otp/request').send({ phone, purpose: 'REGISTER' });
    expect(otp.status).toBe(202);
    const res = await http
      .post('/api/v1/auth/citizen/register')
      .send({ phone, otpCode: '123456', fullName, device: CITIZEN_DEVICE });
    expect(res.status).toBe(201);
    return { token: res.body.data.accessToken as string, phone, fullName };
  }

  async function createReport(token: string) {
    const res = await http
      .post('/api/v1/reports')
      .set(auth(token))
      .send({
        clientReportId: randomUUID(),
        reportKind: 'HELP_REQUEST',
        typeCode: 'TRAFFIC_ACCIDENT',
        location: LOCATION,
        addressText: 'Jl. Contoh No. 7',
        description: DESCRIPTION,
      });
    expect(res.status).toBe(201);
    return { reportId: res.body.data.id as string, incidentId: res.body.data.incident.id as string };
  }

  async function auditRows(action: string, entityId: string) {
    return db.query<Array<{ actor_user_id: string; before_data: unknown; after_data: unknown; request_id: string | null }>>(
      `SELECT actor_user_id, before_data, after_data, request_id FROM audit_logs WHERE action = $1 AND entity_id = $2`,
      [action, entityId],
    );
  }

  const userIdOf = (token: string) =>
    JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub as string;

  beforeAll(async () => {
    ({ app, http } = await createTestApp());
    db = app.get(DataSource);
    await resetLocalRateLimits(app);

    citizenA = await registerCitizen('Warga Pelapor Uji');
    citizenB = await registerCitizen('Warga Lain Uji');
    dispatcher = (await staffLogin(http, 'dispatcher1@contoh.test')).accessToken;
    dispatcher2 = (await staffLogin(http, 'dispatcher2@contoh.test')).accessToken;
    supervisor = (await staffLogin(http, 'supervisor@contoh.test')).accessToken;
    responder = (await staffLogin(http, 'resp.amb1@contoh.test')).accessToken;
    [{ id: responderOrgId }] = await db.query(`SELECT id FROM organizations WHERE code = 'AMBULANS'`);

    ({ reportId, incidentId } = await createReport(citizenA.token));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('laporan warga: hanya milik sendiri', () => {
    it('pemilik dapat membuka laporannya', async () => {
      const res = await http.get(`/api/v1/reports/${reportId}`).set(auth(citizenA.token));
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(reportId);
    });

    it.each([
      ['GET', ''],
      ['GET', '/timeline'],
      ['POST', '/withdraw'],
      ['POST', '/follow-ups'],
    ])('warga lain %s /reports/{id}%s → 404', async (method, suffix) => {
      const path = `/api/v1/reports/${reportId}${suffix}`;
      const req = method === 'GET' ? http.get(path) : http.post(path);
      const res = await req
        .set(auth(citizenB.token))
        .send(suffix === '/follow-ups' ? { clientReportId: randomUUID(), description: 'x' } : { reason: 'x' });
      expectErrorEnvelope(res, 'NOT_FOUND', 404);
    });
  });

  describe('reveal-contact (pii.reveal_reporter + audit pii.view_reporter)', () => {
    it.each([
      ['warga', () => citizenB.token],
      ['responder', () => responder],
    ])('%s → 403', async (_who, token) => {
      const res = await http.post(`/api/v1/reports/${reportId}/reveal-contact`).set(auth(token()));
      expectErrorEnvelope(res, 'FORBIDDEN', 403);
    });

    it('dispatcher → 200 kontak penuh, satu baris audit tanpa nilai PII', async () => {
      const res = await http.post(`/api/v1/reports/${reportId}/reveal-contact`).set(auth(dispatcher));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ name: citizenA.fullName, phone: citizenA.phone });

      const rows = await auditRows('pii.view_reporter', reportId);
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_user_id).toBe(userIdOf(dispatcher));
      expect(rows[0].request_id).toBe(res.headers['x-request-id']);
      const stored = JSON.stringify(rows[0]);
      expect(stored).not.toContain(citizenA.phone);
      expect(stored).not.toContain(citizenA.fullName);
    });

    it('laporan tidak ada → 404 tanpa baris audit', async () => {
      const missing = randomUUID();
      const res = await http.post(`/api/v1/reports/${missing}/reveal-contact`).set(auth(dispatcher));
      expectErrorEnvelope(res, 'NOT_FOUND', 404);
      expect(await auditRows('pii.view_reporter', missing)).toHaveLength(0);
    });
  });

  describe('incident: izin baca per audiens', () => {
    it.each([
      ['/incidents', ''],
      ['/incidents/{id}', 'id'],
      ['/incidents/{id}/nearby', 'nearby'],
    ])('warga GET %s → 403', async (_label, kind) => {
      const path =
        kind === '' ? '/api/v1/incidents' : kind === 'id' ? `/api/v1/incidents/${incidentId}` : `/api/v1/incidents/${incidentId}/nearby`;
      const res = await http.get(path).set(auth(citizenB.token));
      expectErrorEnvelope(res, 'FORBIDDEN', 403);
    });

    it('responder tanpa dispatch/lead → 404 (keberadaan tidak bocor)', async () => {
      const res = await http.get(`/api/v1/incidents/${incidentId}`).set(auth(responder));
      expectErrorEnvelope(res, 'NOT_FOUND', 404);
    });

    it('responder dengan offer (belum accept) → tanpa lokasi, alamat, lampiran, pelapor, korban, dispatch lain', async () => {
      await db.query(
        `INSERT INTO dispatches (incident_id, organization_id, type, origin, status, recorded_by, offered_at)
         VALUES ($1, $2, 'RESPOND', 'DISPATCHER', 'OFFERED', $3, now())`,
        [incidentId, responderOrgId, userIdOf(dispatcher)],
      );
      const res = await http.get(`/api/v1/incidents/${incidentId}`).set(auth(responder));
      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.location).toBeUndefined();
      expect(data.addressText).toBeUndefined();
      expect(data.attachments ?? []).toEqual([]);
      expect(data.reporter?.name ?? null).toBeNull();
      expect(data.reporter?.phoneMasked ?? null).toBeNull();
      expect(data.casualties ?? null).toBeNull();
      expect(data.dispatches ?? []).toEqual([]);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(DESCRIPTION);
      expect(raw).not.toContain(String(LOCATION.lat));
      expect(raw).not.toContain(citizenA.phone);
    });

    it('dispatcher melihat lokasi presisi (DispatcherView)', async () => {
      const res = await http.get(`/api/v1/incidents/${incidentId}`).set(auth(dispatcher));
      expect(res.status).toBe(200);
      expect(res.body.data.location).toEqual({ lat: LOCATION.lat, lng: LOCATION.lng });
    });
  });

  describe('catatan & milestone', () => {
    it('catatan ber-visibility PUBLIC ditolak (tidak boleh tampil di timeline warga)', async () => {
      const res = await http
        .post(`/api/v1/incidents/${incidentId}/notes`)
        .set(auth(dispatcher))
        .send({ text: 'internal', visibility: 'PUBLIC' });
      expectErrorEnvelope(res, 'VALIDATION_FAILED', 400);
    });

    it('catatan pada incident yang tidak ada → 404', async () => {
      const res = await http
        .post(`/api/v1/incidents/${randomUUID()}/notes`)
        .set(auth(dispatcher))
        .send({ text: 'x', visibility: 'INTERNAL' });
      expectErrorEnvelope(res, 'NOT_FOUND', 404);
    });

    it('responder terkait tapi bukan lead → 403 NOT_LEAD_ORGANIZATION; setelah jadi lead → 201 + audit incident.set_lead', async () => {
      const denied = await http
        .post(`/api/v1/incidents/${incidentId}/milestones`)
        .set(auth(responder))
        .send({ code: 'SCENE_RELEASED' });
      expectErrorEnvelope(denied, 'NOT_LEAD_ORGANIZATION', 403);

      const lead = await http
        .put(`/api/v1/incidents/${incidentId}/lead`)
        .set(auth(dispatcher))
        .send({ organizationId: responderOrgId, reason: 'uji' });
      expect(lead.status).toBe(200);
      const rows = await auditRows('incident.set_lead', incidentId);
      expect(rows).toHaveLength(1);
      expect(rows[0].after_data).toEqual({ leadOrganizationId: responderOrgId });

      const ok = await http
        .post(`/api/v1/incidents/${incidentId}/milestones`)
        .set(auth(responder))
        .send({ code: 'SCENE_RELEASED' });
      expect(ok.status).toBe(201);
    });

    it('milestone pada incident yang tidak ada → 404', async () => {
      const res = await http
        .post(`/api/v1/incidents/${randomUUID()}/milestones`)
        .set(auth(dispatcher))
        .send({ code: 'SCENE_RELEASED' });
      expectErrorEnvelope(res, 'NOT_FOUND', 404);
    });
  });

  describe('audit aksi incident wajib (REST §9)', () => {
    it('lock_override: dispatcher lain tanpa izin → 409; supervisor force → 200 + audit', async () => {
      const { incidentId: id } = await createReport(citizenA.token);
      expect((await http.post(`/api/v1/incidents/${id}/lock`).set(auth(dispatcher)).send({})).status).toBe(200);

      const blocked = await http.post(`/api/v1/incidents/${id}/lock`).set(auth(dispatcher2)).send({ force: true });
      expectErrorEnvelope(blocked, 'INCIDENT_LOCKED', 409);
      expect(await auditRows('incident.lock_override', id)).toHaveLength(0);

      const taken = await http.post(`/api/v1/incidents/${id}/lock`).set(auth(supervisor)).send({ force: true });
      expect(taken.status).toBe(200);
      expect(taken.body.data.lockedBy).toBe(userIdOf(supervisor));
      const rows = await auditRows('incident.lock_override', id);
      expect(rows).toHaveLength(1);
      expect(rows[0].before_data).toEqual({ lockedBy: userIdOf(dispatcher) });
    });

    it('invalidate → audit dengan alasan diredaksi', async () => {
      const { incidentId: id } = await createReport(citizenA.token);
      await http.post(`/api/v1/incidents/${id}/lock`).set(auth(dispatcher)).send({});
      const res = await http
        .post(`/api/v1/incidents/${id}/invalidate`)
        .set(auth(dispatcher))
        .send({ reason: 'Laporan iseng' });
      expect(res.status).toBe(200);
      const rows = await auditRows('incident.invalidate', id);
      expect(rows).toHaveLength(1);
      expect(rows[0].before_data).toEqual({ status: 'SUBMITTED' });
      expect(rows[0].after_data).toEqual({ status: 'INVALID' });
      expect(JSON.stringify(rows[0])).not.toContain('Laporan iseng');
    });

    it('merge → audit status + duplicateOfId', async () => {
      const { incidentId: source } = await createReport(citizenA.token);
      const { incidentId: target } = await createReport(citizenB.token);
      await http.post(`/api/v1/incidents/${source}/lock`).set(auth(dispatcher)).send({});
      const res = await http
        .post(`/api/v1/incidents/${source}/merge`)
        .set(auth(dispatcher))
        .send({ targetIncidentId: target });
      expect(res.status).toBe(200);
      const rows = await auditRows('incident.merge', source);
      expect(rows).toHaveLength(1);
      expect(rows[0].after_data).toEqual({ status: 'DUPLICATE', duplicateOfId: target });
    });
  });

  describe('lampiran: hanya pengunggah / dispatcher', () => {
    it('warga lain tidak dapat konfirmasi atau membaca; pengunggah & dispatcher bisa', async () => {
      // Lampiran belum terkait laporan (Q-008: relasi boleh kosong, kind sesuai kontrak).
      const up = await http
        .post('/api/v1/attachments/uploads')
        .set(auth(citizenA.token))
        .send({ fileName: 'foto.jpg', mimeType: 'image/jpeg', sizeBytes: 1024, kind: 'IMAGE', purpose: 'REPORT' });
      expect(up.status).toBe(201);
      const id = up.body.data.attachmentId as string;

      expectErrorEnvelope(await http.post(`/api/v1/attachments/${id}/confirm`).set(auth(citizenB.token)), 'NOT_FOUND', 404);
      expectErrorEnvelope(await http.get(`/api/v1/attachments/${id}/url`).set(auth(citizenB.token)), 'NOT_FOUND', 404);
      expectErrorEnvelope(await http.get(`/api/v1/attachments/${id}/url`).set(auth(responder)), 'NOT_FOUND', 404);

      const confirmed = await http.post(`/api/v1/attachments/${id}/confirm`).set(auth(citizenA.token));
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.data).toMatchObject({ kind: 'IMAGE', status: 'CONFIRMED', reportId: null });
      expect((await http.get(`/api/v1/attachments/${id}/url`).set(auth(dispatcher))).status).toBe(200);
    });
  });
});
