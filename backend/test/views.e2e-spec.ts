import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { expectContract } from './contract';
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
 * Gerbang Fase 2 "tes view (tanpa kebocoran)": setiap respons Fase 2 divalidasi terhadap
 * `contracts/openapi.yaml` (tanpa field di luar kontrak), view per audiens (REST §4.1),
 * antrean `GET /incidents` (filter, kursor, dispatchSummary, attentionReasons), dan
 * CitizenReportView/timeline warga. Dispatch = fixture DB (Fase 3).
 */
describe('View per audiens + kesesuaian kontrak', () => {
  let app: INestApplication;
  let http: Http;
  let db: DataSource;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const IN_AREA = { lat: -7.27, lng: 112.7 }; // Kel. Anggrek, Kec. 99.99.02 (seed)
  const OUT_OF_AREA = { lat: -7.0, lng: 110.0 };
  const DESCRIPTION = 'Pengendara terjepit (uji-view)';

  let citizen: { token: string; phone: string; name: string };
  let otherCitizen: string;
  let dispatcher: string;
  let responder: string; // resp.amb1 — AMBULANS / AMB-01
  let orgIds: Record<string, string>;
  let amb01: string;

  async function registerCitizen(name: string) {
    await resetLocalRateLimits(app);
    const phone = `0896-${String(Date.now()).slice(-4)}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    await http.post('/api/v1/auth/otp/request').send({ phone, purpose: 'REGISTER' });
    const res = await http.post('/api/v1/auth/citizen/register').send({ phone, otpCode: '123456', fullName: name, device: CITIZEN_DEVICE });
    return { token: res.body.data.accessToken as string, phone, name };
  }

  async function report(token: string, overrides: Record<string, unknown> = {}) {
    await resetReportRateLimits(app, userIdOf(token));
    const res = await http
      .post('/api/v1/reports')
      .set(auth(token))
      .send({ clientReportId: randomUUID(), reportKind: 'HELP_REQUEST', typeCode: 'TRAFFIC_ACCIDENT', location: IN_AREA, addressText: 'Jl. Uji View 1', description: DESCRIPTION, ...overrides });
    expect(res.status).toBe(201);
    expectContract(res, 'POST', '/reports');
    return res.body.data as { id: string; incident?: { id: string; code: string }; publicStatus: string; flags: string[] };
  }

  async function dispatch(incidentId: string, orgCode: string, status: string, extra: { type?: string; unitId?: string; acceptedAt?: boolean; offeredSecondsAgo?: number } = {}) {
    const [row] = await db.query(
      `INSERT INTO dispatches (incident_id, organization_id, unit_id, type, origin, status, recorded_by, offered_at, accepted_at, offer_expires_at)
       VALUES ($1, $2, $3, $4, 'DISPATCHER', $5, $6, now() - make_interval(secs => $7), CASE WHEN $8 THEN now() END, now() + interval '2 minutes')
       RETURNING id`,
      [incidentId, orgIds[orgCode], extra.unitId ?? null, extra.type ?? 'RESPOND', status, userIdOf(dispatcher), extra.offeredSecondsAgo ?? 0, extra.acceptedAt ?? false],
    );
    return row.id as string;
  }

  const get = (path: string, token = dispatcher) => http.get(`/api/v1${path}`).set(auth(token));

  beforeAll(async () => {
    ({ app, http } = await createTestApp());
    db = app.get(DataSource);
    citizen = await registerCitizen('Warga View');
    otherCitizen = (await registerCitizen('Warga View Lain')).token;
    dispatcher = (await staffLogin(http, 'dispatcher1@contoh.test')).accessToken;
    responder = (await staffLogin(http, 'resp.amb1@contoh.test')).accessToken;
    const orgs: Array<{ code: string; id: string }> = await db.query(`SELECT code, id FROM organizations`);
    orgIds = Object.fromEntries(orgs.map((o) => [o.code, o.id]));
    [{ id: amb01 }] = await db.query(`SELECT id FROM units WHERE code = 'AMB-01'`);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('DispatcherView', () => {
    it('detail: lokasi presisi, deskripsi laporan, pelapor dimask, lampiran, korban, dispatch — sesuai kontrak', async () => {
      const r = await report(citizen.token);
      const id = r.incident!.id;
      await db.query(
        `INSERT INTO attachments (incident_id, report_id, uploaded_by, kind, status, storage_key, mime_type)
         VALUES ($1, $2, $3, 'IMAGE', 'CONFIRMED', 'uploads/x/foto-tkp.jpg', 'image/jpeg')`,
        [id, r.id, userIdOf(citizen.token)],
      );
      await dispatch(id, 'AMBULANS', 'EN_ROUTE', { unitId: amb01 });

      const res = await get(`/incidents/${id}`);
      expect(res.status).toBe(200);
      expectContract(res, 'GET', '/incidents/{id}');
      const d = res.body.data;
      expect(d.location).toEqual(IN_AREA);
      expect(d.description).toBe(DESCRIPTION);
      expect(d.district).toEqual({ code: '99.99.02', name: expect.any(String) });
      expect(d.reporter.name).toBe(citizen.name);
      expect(d.reporter.phoneMasked).toMatch(/^\d{4}\*{4}\d{3}$/);
      expect(JSON.stringify(res.body)).not.toContain(citizen.phone);
      expect(d.attachments).toEqual([{ id: expect.any(String), fileName: 'foto-tkp.jpg', mimeType: 'image/jpeg', kind: 'IMAGE' }]);
      expect(d.dispatches).toEqual([
        expect.objectContaining({ organization: expect.objectContaining({ id: orgIds.AMBULANS }), status: 'EN_ROUTE', type: 'RESPOND' }),
      ]);
      expect(d.publicStatus).toBe('RECEIVED');
    });

    it('respons aksi dispatcher = DispatcherViewIncident (verify, PATCH, lead, resolve, close)', async () => {
      const id = (await report(citizen.token)).incident!.id;
      expectContract(await http.post(`/api/v1/incidents/${id}/lock`).set(auth(dispatcher)).send({}), 'POST', '/incidents/{id}/lock');
      expectContract(await http.post(`/api/v1/incidents/${id}/lock/renew`).set(auth(dispatcher)), 'POST', '/incidents/{id}/lock/renew');
      const verify = await http.post(`/api/v1/incidents/${id}/verify`).set(auth(dispatcher)).send({ version: 1, severity: 'HIGH' });
      expectContract(verify, 'POST', '/incidents/{id}/verify');
      expect(verify.body.data).toMatchObject({ status: 'VERIFIED', publicStatus: 'VERIFIED', version: 2 });
      const patch = await http.patch(`/api/v1/incidents/${id}`).set(auth(dispatcher)).send({ version: 2, summary: 'ringkas' });
      expectContract(patch, 'PATCH', '/incidents/{id}');
      const lead = await http.put(`/api/v1/incidents/${id}/lead`).set(auth(dispatcher)).send({ organizationId: orgIds.DAMKAR, reason: 'uji' });
      expectContract(lead, 'PUT', '/incidents/{id}/lead');
      const resolve = await http.post(`/api/v1/incidents/${id}/resolve`).set(auth(dispatcher)).send({ version: 4 });
      expectContract(resolve, 'POST', '/incidents/{id}/resolve');
      expect(resolve.body.data.publicStatus).toBe('RESOLVED');
      expectContract(await http.post(`/api/v1/incidents/${id}/close`).set(auth(dispatcher)).send({ version: 5 }), 'POST', '/incidents/{id}/close');
    });

    it('invalidate & merge sesuai kontrak; warga melihat publicStatus induk setelah merge', async () => {
      const a = await report(citizen.token);
      const b = await report(otherCitizen);
      await http.post(`/api/v1/incidents/${a.incident!.id}/lock`).set(auth(dispatcher)).send({});
      const merge = await http.post(`/api/v1/incidents/${a.incident!.id}/merge`).set(auth(dispatcher)).send({ version: 1, targetIncidentId: b.incident!.id });
      expectContract(merge, 'POST', '/incidents/{id}/merge');
      await http.post(`/api/v1/incidents/${b.incident!.id}/lock`).set(auth(dispatcher)).send({});
      const inv = await http.post(`/api/v1/incidents/${b.incident!.id}/invalidate`).set(auth(dispatcher)).send({ version: 2, reason: 'tidak ditemukan' });
      expectContract(inv, 'POST', '/incidents/{id}/invalidate');
      const mine = await get(`/reports/${a.id}`, citizen.token);
      expect(mine.body.data).toMatchObject({ incident: { id: b.incident!.id }, publicStatus: 'NOT_VALID' });
    });

    it('catatan, milestone, korban sesuai kontrak; actorName = nama staf (bukan id)', async () => {
      const id = (await report(citizen.token)).incident!.id;
      await http.post(`/api/v1/incidents/${id}/lock`).set(auth(dispatcher)).send({});
      const note = await http.post(`/api/v1/incidents/${id}/notes`).set(auth(dispatcher)).send({ text: 'cek CCTV', visibility: 'INTERNAL' });
      expect(note.status).toBe(201);
      expectContract(note, 'POST', '/incidents/{id}/notes');
      expect(note.body.data).toMatchObject({ type: 'incident.note_added', note: 'cek CCTV', actorName: 'Dispatcher Rina' });
      const ms = await http.post(`/api/v1/incidents/${id}/milestones`).set(auth(dispatcher)).send({ code: 'ROAD_REOPENED' });
      expectContract(ms, 'POST', '/incidents/{id}/milestones');
      expect(ms.body.data.code).toBe('ROAD_REOPENED');
      const future = await http
        .post(`/api/v1/incidents/${id}/milestones`)
        .set(auth(dispatcher))
        .send({ code: 'ROAD_REOPENED', occurredAt: new Date(Date.now() + 3_600_000).toISOString() });
      expectErrorEnvelope(future, 'OCCURRED_AT_OUT_OF_RANGE', 422);
      const cas = await http.post(`/api/v1/incidents/${id}/casualties`).set(auth(dispatcher)).send({ injured: 1, deceased: 0 });
      expectContract(cas, 'POST', '/incidents/{id}/casualties');
    });

    it('events: kursor afterId; responder terkait hanya melihat UNITS/PUBLIC', async () => {
      const id = (await report(citizen.token)).incident!.id;
      await http.post(`/api/v1/incidents/${id}/lock`).set(auth(dispatcher)).send({});
      await http.post(`/api/v1/incidents/${id}/notes`).set(auth(dispatcher)).send({ text: 'rahasia-internal', visibility: 'INTERNAL' });
      await http.post(`/api/v1/incidents/${id}/notes`).set(auth(dispatcher)).send({ text: 'untuk-unit', visibility: 'UNITS' });

      const first = await get(`/incidents/${id}/events?limit=2`);
      expectContract(first, 'GET', '/incidents/{id}/events');
      expect(first.body.page.hasMore).toBe(true);
      const rest = await get(`/incidents/${id}/events?afterId=${first.body.page.nextCursor}`);
      const all = [...first.body.data, ...rest.body.data].map((e: { note?: string }) => e.note);
      expect(all).toEqual(expect.arrayContaining(['rahasia-internal', 'untuk-unit']));

      expectErrorEnvelope(await get(`/incidents/${id}/events`, responder), 'NOT_FOUND', 404);
      await dispatch(id, 'AMBULANS', 'OFFERED');
      const res = await get(`/incidents/${id}/events`, responder);
      expectContract(res, 'GET', '/incidents/{id}/events');
      const notes = res.body.data.map((e: { note?: string }) => e.note);
      expect(notes).toContain('untuk-unit');
      expect(JSON.stringify(res.body)).not.toContain('rahasia-internal');
    });

    it('id bukan UUID → 404 (bukan 500)', async () => {
      expectErrorEnvelope(await get('/incidents/bukan-uuid'), 'NOT_FOUND', 404);
      expectErrorEnvelope(await get('/reports/bukan-uuid', citizen.token), 'NOT_FOUND', 404);
    });
  });

  describe('OfferView / UnitView (responder)', () => {
    it('offer belum diterima → OfferView tanpa data sensitif', async () => {
      const id = (await report(citizen.token)).incident!.id;
      const dispatchId = await dispatch(id, 'AMBULANS', 'OFFERED', { unitId: amb01 });
      const res = await get(`/incidents/${id}`, responder);
      expect(res.status).toBe(200);
      expectContract(res, 'GET', '/incidents/{id}');
      expect(res.body.data).toMatchObject({ dispatchId, status: 'OFFERED', type: 'RESPOND' });
      expect(Object.keys(res.body.data.incident).sort()).toEqual(expect.arrayContaining(['code', 'district', 'severity', 'type', 'village'].filter((k) => k !== 'severity')));
      for (const leak of [DESCRIPTION, 'Jl. Uji View 1', String(IN_AREA.lat), citizen.phone, citizen.name]) {
        expect(JSON.stringify(res.body)).not.toContain(leak);
      }
    });

    it('sesudah accept → UnitView: lokasi presisi + dispatch lain tanpa unit (bukan lead), pelapor tetap tidak ada', async () => {
      const id = (await report(citizen.token)).incident!.id;
      const mine = await dispatch(id, 'AMBULANS', 'ACCEPTED', { unitId: amb01, acceptedAt: true });
      const [{ id: patrol }] = await db.query(`SELECT id FROM units WHERE code = 'PATROL-01'`);
      await dispatch(id, 'POLRES', 'EN_ROUTE', { unitId: patrol });
      const res = await get(`/incidents/${id}`, responder);
      expectContract(res, 'GET', '/incidents/{id}');
      const v = res.body.data;
      expect(v.dispatchId).toBe(mine);
      expect(v.incident.location).toEqual(IN_AREA);
      expect(v.incident.description).toBe(DESCRIPTION);
      expect(v.incident.otherDispatches).toEqual([{ organization: expect.objectContaining({ id: orgIds.POLRES }), status: 'EN_ROUTE', type: 'RESPOND' }]);
      expect(JSON.stringify(res.body)).not.toContain(citizen.phone);
      expect(JSON.stringify(res.body)).not.toContain(citizen.name);
    });

    it('NOTIFY (IGD) tetap OfferView — tanpa lokasi kejadian', async () => {
      const id = (await report(citizen.token)).incident!.id;
      await dispatch(id, 'RSUD', 'READY', { type: 'NOTIFY' });
      const igd = (await staffLogin(http, 'resp.igd1@contoh.test')).accessToken;
      const res = await get(`/incidents/${id}`, igd);
      expectContract(res, 'GET', '/incidents/{id}');
      expect(res.body.data.incident.location).toBeUndefined();
    });
  });

  describe('antrean GET /incidents', () => {
    it('sesuai kontrak; filter, kursor tanpa tumpang tindih, sort -severity', async () => {
      const marker = `UJIQ${Date.now()}`;
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push((await report(citizen.token, { addressText: `${marker} ${i}` })).incident!.id);

      const p1 = await get(`/incidents?q=${marker}&limit=2`);
      expectContract(p1, 'GET', '/incidents');
      expect(p1.body.data).toHaveLength(2);
      expect(p1.body.page.hasMore).toBe(true);
      const p2 = await get(`/incidents?q=${marker}&limit=2&cursor=${encodeURIComponent(p1.body.page.nextCursor)}`);
      expect(p2.body.data).toHaveLength(1);
      expect(p2.body.page).toEqual({ hasMore: false, nextCursor: null });
      const seen = [...p1.body.data, ...p2.body.data].map((x: { id: string }) => x.id);
      expect(seen).toEqual([...ids].reverse());

      await db.query(`UPDATE incidents SET severity = 'MASS' WHERE id = $1`, [ids[0]]);
      const bySev = await get(`/incidents?q=${marker}&sort=-severity`);
      expect(bySev.body.data[0].id).toBe(ids[0]);
      expect((await get(`/incidents?q=${marker}&severity=MASS`)).body.data.map((x: { id: string }) => x.id)).toEqual([ids[0]]);
      expect((await get(`/incidents?q=${marker}&status=VERIFIED,RESOLVED`)).body.data).toEqual([]);
      expect((await get(`/incidents?q=${marker}&districtId=${randomUUID()}`)).body.data).toEqual([]);

      expectErrorEnvelope(await get('/incidents?status=SALAH'), 'VALIDATION_FAILED', 400);
      expectErrorEnvelope(await get('/incidents?sort=nama'), 'VALIDATION_FAILED', 400);
      expectErrorEnvelope(await get('/incidents?cursor=rusak'), 'VALIDATION_FAILED', 400);
    });

    it('dispatchSummary dan attentionReasons dari state server', async () => {
      const marker = `UJIA${Date.now()}`;
      const id = (await report(citizen.token, { addressText: marker })).incident!.id;
      await dispatch(id, 'AMBULANS', 'EN_ROUTE');
      await dispatch(id, 'POLRES', 'REJECTED');
      await dispatch(id, 'DAMKAR', 'OFFERED', { offeredSecondsAgo: 120 });
      await db.query(
        `INSERT INTO resource_requests (incident_id, requested_by, organization_id, resource_type, urgency, status)
         VALUES ($1, $2, $3, 'AMBULANCE', 'URGENT', 'PENDING')`,
        [id, userIdOf(responder), orgIds.AMBULANS],
      );
      const res = await get(`/incidents?q=${marker}`);
      expectContract(res, 'GET', '/incidents');
      const item = res.body.data[0];
      expect(item.dispatchSummary).toEqual({
        active: 1,
        offered: 1,
        rejected: 1,
        expired: 0,
        byOrganization: [{ organization: expect.objectContaining({ id: orgIds.AMBULANS }), active: 1 }],
      });
      // Dispatch DAMKAR dibuat setelah penolakan POLRES → sudah ada pengganti.
      expect(item.attentionReasons.sort()).toEqual(['PENDING_RESOURCE_REQUEST', 'UNSEEN_OFFER']);

      await db.query(`UPDATE dispatches SET updated_at = now() + interval '1 minute' WHERE incident_id = $1 AND status = 'REJECTED'`, [id]);
      const again = await get(`/incidents?q=${marker}`);
      expect(again.body.data[0].attentionReasons).toContain('NEEDS_REPLACEMENT');
    });

    it('nearby: sesuai kontrak, hanya dalam radius; parameter divalidasi', async () => {
      // Titik acak per run (luar wilayah tetap membuat incident) agar tidak tertimbun data run lain.
      const base = { lat: -6.5 - Math.random() * 0.4, lng: 111 + Math.random() * 0.4 };
      const a = (await report(citizen.token, { location: base })).incident!.id;
      const near = (await report(citizen.token, { location: { lat: base.lat + 0.0001, lng: base.lng + 0.0001 } })).incident!.id;
      const far = (await report(citizen.token, { location: { lat: base.lat + 0.01, lng: base.lng } })).incident!.id;
      const res = await get(`/incidents/${a}/nearby?radiusM=50`);
      expectContract(res, 'GET', '/incidents/{id}/nearby');
      const found = res.body.data.map((x: { id: string }) => x.id);
      expect(found).toContain(near);
      expect(found).not.toContain(a);
      expect(found).not.toContain(far);
      expectErrorEnvelope(await get(`/incidents/${a}/nearby?radiusM=0`), 'VALIDATION_FAILED', 400);
    });
  });

  describe('CitizenReportView & timeline warga', () => {
    it('laporan di dalam wilayah: incident punya kecamatan/kelurahan; luar wilayah: OUT_OF_AREA', async () => {
      const inside = await report(citizen.token);
      expect(inside.flags).toEqual([]);
      const [inc] = await db.query(
        `SELECT d.code AS district, v.code AS village FROM incidents i JOIN regions d ON d.id = i.district_id JOIN regions v ON v.id = i.village_id WHERE i.id = $1`,
        [inside.incident!.id],
      );
      expect(inc).toEqual({ district: '99.99.02', village: '99.99.02.1001' });

      const outside = await report(citizen.token, { location: OUT_OF_AREA });
      expect(outside).toMatchObject({ flags: ['OUT_OF_AREA'], publicStatus: 'OUT_OF_AREA' });
      const flagged = await get(`/incidents?flag=OUT_OF_AREA&q=${encodeURIComponent('Jl. Uji View 1')}`);
      expect(flagged.body.data.map((x: { id: string }) => x.id)).toContain(outside.incident!.id);
    });

    it('GET /reports/{id}, /mine (kursor), /incidents/{id}/reports sesuai kontrak; nomor darurat contoh', async () => {
      const token = (await registerCitizen('Warga Mine')).token;
      const r1 = await report(token);
      const r2 = await report(token, { reportKind: 'CONDITION_REPORT', typeCode: 'FLOOD' });
      const one = await get(`/reports/${r1.id}`, token);
      expectContract(one, 'GET', '/reports/{id}');
      expect(one.body.data.location).toEqual(IN_AREA);
      expect(one.body.data.emergencyContacts.map((c: { phone: string }) => c.phone)).not.toContain('112');

      const p1 = await get('/reports/mine?limit=1', token);
      expectContract(p1, 'GET', '/reports/mine');
      expect(p1.body.data.map((x: { id: string }) => x.id)).toEqual([r2.id]);
      const p2 = await get(`/reports/mine?limit=1&cursor=${encodeURIComponent(p1.body.page.nextCursor)}`, token);
      expect(p2.body.data.map((x: { id: string }) => x.id)).toEqual([r1.id]);
      expect(p2.body.page.hasMore).toBe(false);

      const linked = await get(`/incidents/${r1.incident!.id}/reports`);
      expectContract(linked, 'GET', '/incidents/{id}/reports');
      expect(linked.body.data.map((x: { id: string }) => x.id)).toEqual([r1.id]);
      expect(JSON.stringify(linked.body)).not.toContain('phone":"08');
    });

    it('timeline hanya teks publik: diterima → diverifikasi; catatan internal tidak tampil', async () => {
      const r = await report(citizen.token);
      const id = r.incident!.id;
      await http.post(`/api/v1/incidents/${id}/lock`).set(auth(dispatcher)).send({});
      await http.post(`/api/v1/incidents/${id}/notes`).set(auth(dispatcher)).send({ text: 'catatan-dispatcher', visibility: 'UNITS' });
      await http.post(`/api/v1/incidents/${id}/verify`).set(auth(dispatcher)).send({ version: 1, severity: 'LOW' });
      const res = await get(`/reports/${r.id}/timeline`, citizen.token);
      expectContract(res, 'GET', '/reports/{id}/timeline');
      expect(res.body.data.map((e: { text: string }) => e.text)).toEqual(['Laporan diterima.', 'Laporan diverifikasi.']);
      expect(JSON.stringify(res.body)).not.toContain('catatan-dispatcher');
      expect(JSON.stringify(res.body)).not.toContain('Dispatcher Rina');
      const detail = await get(`/reports/${r.id}`, citizen.token);
      expect(detail.body.data.publicStatus).toBe('VERIFIED');
    });

    it('reveal-contact, unggah & konfirmasi lampiran sesuai kontrak', async () => {
      const r = await report(citizen.token);
      expectContract(await http.post(`/api/v1/reports/${r.id}/reveal-contact`).set(auth(dispatcher)), 'POST', '/reports/{id}/reveal-contact');
      const up = await http
        .post('/api/v1/attachments/uploads')
        .set(auth(citizen.token))
        .send({ fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10, kind: 'IMAGE', purpose: 'REPORT' });
      expectContract(up, 'POST', '/attachments/uploads');
      const conf = await http.post(`/api/v1/attachments/${up.body.data.attachmentId}/confirm`).set(auth(citizen.token));
      expectContract(conf, 'POST', '/attachments/{id}/confirm');
    });
  });
});
