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
  userIdOf,
} from './e2e-utils';

/**
 * S5 (REST §10): idempotensi `clientReportId`, termasuk pengiriman bersamaan;
 * batas laju laporan (REST §8) yang tidak menghitung pengulangan; penautan lampiran
 * hanya milik sendiri (syarat selesai §7.2 `reports`).
 */
describe('Laporan: idempotensi (S5), batas laju, lampiran', () => {
  let app: INestApplication;
  let http: Http;
  let db: DataSource;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function registerCitizen(fullName: string): Promise<string> {
    await resetLocalRateLimits(app);
    const phone = `0898-${String(Date.now()).slice(-4)}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    expect((await http.post('/api/v1/auth/otp/request').send({ phone, purpose: 'REGISTER' })).status).toBe(202);
    const res = await http
      .post('/api/v1/auth/citizen/register')
      .send({ phone, otpCode: '123456', fullName, device: CITIZEN_DEVICE });
    expect(res.status).toBe(201);
    const token = res.body.data.accessToken as string;
    await resetReportRateLimits(app, userIdOf(token));
    return token;
  }

  const helpBody = (overrides: Record<string, unknown> = {}) => ({
    clientReportId: randomUUID(),
    reportKind: 'HELP_REQUEST',
    typeCode: 'TRAFFIC_ACCIDENT',
    location: { lat: -7.27, lng: 112.7 },
    addressText: 'Jl. Uji S5',
    description: 'uji idempotensi',
    ...overrides,
  });

  const post = (token: string, body: object) => http.post('/api/v1/reports').set(auth(token)).send(body);

  async function rowsFor(clientReportId: string) {
    const [r] = await db.query<Array<{ reports: string; incidents: string }>>(
      `SELECT count(*)::text AS reports, count(DISTINCT incident_id)::text AS incidents
         FROM incident_reports WHERE client_report_id = $1`,
      [clientReportId],
    );
    return { reports: Number(r.reports), incidents: Number(r.incidents) };
  }

  async function upload(token: string): Promise<string> {
    const res = await http
      .post('/api/v1/attachments/uploads')
      .set(auth(token))
      .send({ fileName: 'foto.jpg', mimeType: 'image/jpeg', sizeBytes: 2048, kind: 'IMAGE', purpose: 'REPORT' });
    expect(res.status).toBe(201);
    return res.body.data.attachmentId as string;
  }

  beforeAll(async () => {
    ({ app, http } = await createTestApp());
    db = app.get(DataSource);
    await resetLocalRateLimits(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('S5 idempotensi clientReportId', () => {
    it('tiga kali berurutan → 201, 200, 200; resource sama; satu laporan & satu incident', async () => {
      const token = await registerCitizen('Warga S5 Urut');
      const body = helpBody();
      const res = [await post(token, body), await post(token, body), await post(token, body)];
      expect(res.map((r) => r.status)).toEqual([201, 200, 200]);
      const ids = new Set(res.map((r) => r.body.data.id));
      const incidents = new Set(res.map((r) => r.body.data.incident.id));
      expect(ids.size).toBe(1);
      expect(incidents.size).toBe(1);
      expect(await rowsFor(body.clientReportId)).toEqual({ reports: 1, incidents: 1 });
    });

    it('lima kali bersamaan → tepat satu 201, sisanya 200, tanpa 500', async () => {
      const token = await registerCitizen('Warga S5 Paralel');
      const body = helpBody();
      const res = await Promise.all(Array.from({ length: 5 }, () => post(token, body)));
      const statuses = res.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 200, 200, 200, 201]);
      expect(new Set(res.map((r) => r.body.data.id)).size).toBe(1);
      expect(await rowsFor(body.clientReportId)).toEqual({ reports: 1, incidents: 1 });
    });

    it('pelapor lain memakai clientReportId yang sama → 422 IDEMPOTENCY_CONFLICT tanpa isi laporan', async () => {
      const owner = await registerCitizen('Warga S5 Pemilik');
      const other = await registerCitizen('Warga S5 Lain');
      const body = helpBody({ description: 'rahasia-pemilik-s5' });
      expect((await post(owner, body)).status).toBe(201);

      const res = await post(other, body);
      expectErrorEnvelope(res, 'IDEMPOTENCY_CONFLICT', 422);
      expect(JSON.stringify(res.body)).not.toContain('rahasia-pemilik-s5');
      expect(await rowsFor(body.clientReportId)).toEqual({ reports: 1, incidents: 1 });
    });

    it('CONDITION_REPORT tidak membuat incident; pengulangan tetap 200', async () => {
      const token = await registerCitizen('Warga S5 Kondisi');
      const body = helpBody({ reportKind: 'CONDITION_REPORT', typeCode: 'FLOOD' });
      const first = await post(token, body);
      expect(first.status).toBe(201);
      expect(first.body.data.incident).toBeUndefined();
      expect((await post(token, body)).status).toBe(200);
      expect(await rowsFor(body.clientReportId)).toEqual({ reports: 1, incidents: 0 });
    });
  });

  describe('batas laju laporan (REST §8)', () => {
    it('HELP_REQUEST ke-4 dalam jendela → 429 + Retry-After; pengulangan tetap 200 dan tidak dihitung', async () => {
      const token = await registerCitizen('Warga Batas Laju');
      const first = helpBody();
      expect((await post(token, first)).status).toBe(201);
      // Pengulangan berkali-kali tidak memakan jatah.
      for (let i = 0; i < 3; i++) expect((await post(token, first)).status).toBe(200);
      expect((await post(token, helpBody())).status).toBe(201);
      expect((await post(token, helpBody())).status).toBe(201);

      const blocked = await post(token, helpBody());
      expectErrorEnvelope(blocked, 'RATE_LIMITED', 429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

      // Antrean offline yang mengulang laporan lama tidak terblokir.
      expect((await post(token, first)).status).toBe(200);
      // Batas HELP_REQUEST tidak memengaruhi CONDITION_REPORT.
      expect((await post(token, helpBody({ reportKind: 'CONDITION_REPORT', typeCode: 'FLOOD' }))).status).toBe(201);
    });

    it('permintaan yang gagal validasi tidak memakan jatah', async () => {
      const token = await registerCitizen('Warga Gagal');
      const foreignAttachment = randomUUID();
      for (let i = 0; i < 4; i++) {
        const res = await post(token, helpBody({ attachmentIds: [foreignAttachment] }));
        expectErrorEnvelope(res, 'VALIDATION_FAILED', 400);
      }
      for (let i = 0; i < 3; i++) expect((await post(token, helpBody())).status).toBe(201);
    });
  });

  describe('lampiran pada laporan', () => {
    it('lampiran milik warga lain ditolak dan seluruh laporan dibatalkan', async () => {
      const owner = await registerCitizen('Warga Lampiran Pemilik');
      const thief = await registerCitizen('Warga Lampiran Lain');
      const attachmentId = await upload(owner);
      const body = helpBody({ attachmentIds: [attachmentId] });

      expectErrorEnvelope(await post(thief, body), 'VALIDATION_FAILED', 400);
      expect(await rowsFor(body.clientReportId)).toEqual({ reports: 0, incidents: 0 });
      const [att] = await db.query(`SELECT report_id FROM attachments WHERE id = $1`, [attachmentId]);
      expect(att.report_id).toBeNull();
    });

    it('lampiran milik sendiri tertaut; tidak bisa dipakai ulang di laporan lain', async () => {
      const token = await registerCitizen('Warga Lampiran Sendiri');
      const attachmentId = await upload(token);
      expect((await http.post(`/api/v1/attachments/${attachmentId}/confirm`).set(auth(token))).status).toBe(200);

      const created = await post(token, helpBody({ attachmentIds: [attachmentId] }));
      expect(created.status).toBe(201);
      const [att] = await db.query(`SELECT report_id, incident_id FROM attachments WHERE id = $1`, [attachmentId]);
      expect(att).toEqual({ report_id: created.body.data.id, incident_id: created.body.data.incident.id });

      expectErrorEnvelope(await post(token, helpBody({ attachmentIds: [attachmentId] })), 'VALIDATION_FAILED', 400);
    });

    it('melebihi limits.max_attachments atau id berulang → 400', async () => {
      const token = await registerCitizen('Warga Lampiran Banyak');
      const six = Array.from({ length: 6 }, () => randomUUID());
      expectErrorEnvelope(await post(token, helpBody({ attachmentIds: six })), 'VALIDATION_FAILED', 400);
      const id = randomUUID();
      expectErrorEnvelope(await post(token, helpBody({ attachmentIds: [id, id] })), 'VALIDATION_FAILED', 400);
    });
  });

  describe('laporan susulan (follow-up)', () => {
    it('idempoten lewat clientReportId dan tertaut ke incident yang sama', async () => {
      const token = await registerCitizen('Warga Susulan');
      const parent = await post(token, helpBody());
      expect(parent.status).toBe(201);
      const followBody = { clientReportId: randomUUID(), description: 'korban bertambah' };
      const path = `/api/v1/reports/${parent.body.data.id}/follow-ups`;

      const res = await Promise.all([1, 2, 3].map(() => http.post(path).set(auth(token)).send(followBody)));
      expect(res.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(new Set(res.map((r) => r.body.data.id)).size).toBe(1);
      expect(res[0].body.data.incident.id).toBe(parent.body.data.incident.id);
      expect(await rowsFor(followBody.clientReportId)).toEqual({ reports: 1, incidents: 1 });
    });
  });
});
