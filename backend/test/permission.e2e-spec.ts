import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
} from '../src/modules/permissions/permissions.catalog';
import {
  CITIZEN_DEVICE,
  Http,
  createTestApp,
  expectErrorEnvelope,
  resetLocalRateLimits,
  staffLogin,
} from './e2e-utils';

const RUN = Date.now();
const WARGA_PHONE = `0877${RUN}`;

const AKUN: { email: string; role: keyof typeof ROLE_PERMISSIONS }[] = [
  { email: 'dispatcher1@contoh.test', role: 'DISPATCHER' },
  { email: 'resp.damkar1@contoh.test', role: 'RESPONDER' },
  { email: 'superadmin@contoh.test', role: 'SUPER_ADMIN' },
];

describe('Permission (uji e2e HTTP)', () => {
  let app: INestApplication;
  let http: Http;

  beforeAll(async () => {
    ({ app, http } = await createTestApp());
    await resetLocalRateLimits(app);
  });

  afterAll(async () => {
    const ds = app.get(DataSource);
    await ds.query(`DELETE FROM users WHERE phone = $1`, [WARGA_PHONE]);
    await app.close();
  });

  it.each(AKUN)(
    'GET /me $role mengembalikan matriks izin persis seperti katalog',
    async ({ email, role }) => {
      const { accessToken } = await staffLogin(http, email);
      const res = await http.get('/api/v1/me').set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.roles).toContain(role);
      // Penegakan server-side == katalog REST §3.
      expect([...res.body.data.permissions].sort()).toEqual([...ROLE_PERMISSIONS[role]].sort());
    },
  );

  it('access token membawa role tetapi TIDAK membawa permission (REST §2)', async () => {
    const { accessToken } = await staffLogin(http, 'dispatcher1@contoh.test');
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

    expect(payload.roles).toEqual(['DISPATCHER']);
    expect(payload).not.toHaveProperty('permissions');
  });

  it('responder tidak memperoleh izin insiden penuh maupun kerahasiaan PII', async () => {
    const { accessToken } = await staffLogin(http, 'resp.damkar1@contoh.test');
    const res = await http.get('/api/v1/me').set('Authorization', `Bearer ${accessToken}`);
    const permissions = res.body.data.permissions as string[];

    expect(permissions).toContain('dispatch.respond');
    expect(permissions).toContain('incident.read_related');
    expect(permissions).not.toContain('incident.read_all');
    expect(permissions).not.toContain('pii.reveal_reporter');
    expect(permissions).not.toContain('settings.manage');
  });

  it('warga melihat roles tetapi tidak daftar permission staf', async () => {
    await http.post('/api/v1/auth/otp/request').send({ phone: WARGA_PHONE, purpose: 'REGISTER' });
    const daftar = await http.post('/api/v1/auth/citizen/register').send({
      phone: WARGA_PHONE,
      otpCode: '123456',
      fullName: 'Warga Matriks',
      device: CITIZEN_DEVICE,
    });
    expect(daftar.status).toBe(201);
    const token = daftar.body.data.accessToken as string;

    const res = await http.get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.roles).toEqual(['CITIZEN']);
    expect(res.body.data.permissions).toBeUndefined();
  });

  it('endpoint terproteksi menolak tanpa token; endpoint publik tetap terbuka', async () => {
    expectErrorEnvelope(await http.get('/api/v1/me'), 'UNAUTHENTICATED', 401);
    expectErrorEnvelope(await http.get('/api/v1/incident-types'), 'UNAUTHENTICATED', 401);

    const konfig = await http.get('/api/v1/config/public');
    expect(konfig.status).toBe(200);
    expect(konfig.body.data.sampleMode).toBe(true);
    // Nomor darurat memakai nomor contoh, bukan nomor asli.
    for (const kontak of konfig.body.data.emergencyContacts as { phone: string }[]) {
      expect(kontak.phone).toMatch(/^000-/);
    }
  });

  it('GET /roles & /permissions dijaga role.manage: 403 tanpa izin, 200 untuk super admin', async () => {
    const dispatcher = await staffLogin(http, 'dispatcher1@contoh.test');
    expectErrorEnvelope(
      await http.get('/api/v1/roles').set('Authorization', `Bearer ${dispatcher.accessToken}`),
      'FORBIDDEN',
      403,
    );
    expectErrorEnvelope(
      await http.get('/api/v1/permissions').set('Authorization', `Bearer ${dispatcher.accessToken}`),
      'FORBIDDEN',
      403,
    );

    const responder = await staffLogin(http, 'resp.damkar1@contoh.test');
    expectErrorEnvelope(
      await http.get('/api/v1/roles').set('Authorization', `Bearer ${responder.accessToken}`),
      'FORBIDDEN',
      403,
    );

    // Tanpa token: autentikasi didahulukan, tetap 401.
    expectErrorEnvelope(await http.get('/api/v1/roles'), 'UNAUTHENTICATED', 401);
    expectErrorEnvelope(await http.get('/api/v1/permissions'), 'UNAUTHENTICATED', 401);

    const admin = await staffLogin(http, 'superadmin@contoh.test');
    const roles = await http.get('/api/v1/roles').set('Authorization', `Bearer ${admin.accessToken}`);
    expect(roles.status).toBe(200);
    expect([...roles.body.data].map((row: { code: string }) => row.code).sort()).toEqual(
      Object.keys(ROLE_PERMISSIONS).sort(),
    );
    for (const row of roles.body.data as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual(['code', 'name']);
    }

    const perms = await http
      .get('/api/v1/permissions')
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(perms.status).toBe(200);
    expect([...perms.body.data].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('token rusak ditolak dengan amplop galat', async () => {
    expectErrorEnvelope(
      await http.get('/api/v1/me').set('Authorization', 'Bearer bukan-jwt'),
      'UNAUTHENTICATED',
      401,
    );
  });
});
