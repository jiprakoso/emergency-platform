import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { generateSync } from 'otplib';
import { DEMO_PASSWORD } from '../src/modules/seed/seed-data';
import {
  CITIZEN_DEVICE,
  Http,
  STAFF_DEVICE,
  createTestApp,
  expectErrorEnvelope,
  resetLocalRateLimits,
} from './e2e-utils';

const STAFF_PHONE_2FA = '0800-0000-1004'; // dispatcher2 (seed) — 2FA dipasang di sini
const RUN = Date.now();
const CITIZEN_PHONE = `0899${RUN}`;
const UNKNOWN_IDENTIFIER = `tidak-ada-${RUN}@contoh.test`;

describe('Autentikasi (uji e2e HTTP)', () => {
  let app: INestApplication;
  let http: Http;
  let dispatcherToken = '';
  let dispatcherRefresh = '';

  beforeAll(async () => {
    ({ app, http } = await createTestApp());
    await resetLocalRateLimits(app);
  });

  afterAll(async () => {
    const ds = app.get(DataSource);
    await ds.query(
      `UPDATE users SET two_factor_enabled = false, two_factor_secret = NULL WHERE phone = $1`,
      [STAFF_PHONE_2FA],
    );
    await ds.query(`DELETE FROM users WHERE phone = $1`, [CITIZEN_PHONE]);
    await app.close();
  });

  it('menolak kredensial salah dengan amplop galat', async () => {
    const res = await http.post('/api/v1/auth/staff/login').send({
      identifier: UNKNOWN_IDENTIFIER,
      password: 'bukan-sandi',
      device: STAFF_DEVICE,
    });
    expectErrorEnvelope(res, 'UNAUTHENTICATED', 401);
  });

  it('login staf sukses mengeluarkan token yang berlaku pada endpoint terproteksi', async () => {
    const res = await http
      .post('/api/v1/auth/staff/login')
      .send({
        identifier: 'dispatcher1@contoh.test',
        password: DEMO_PASSWORD,
        device: STAFF_DEVICE,
      });
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.accessToken).toEqual(expect.any(String));
    expect(data.refreshToken).toMatch(/^r1\./);
    expect(data.user.roles).toEqual(['DISPATCHER']);

    dispatcherToken = data.accessToken;
    dispatcherRefresh = data.refreshToken;

    const me = await http.get('/api/v1/me').set('Authorization', `Bearer ${dispatcherToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.roles).toContain('DISPATCHER');
  });

  it('rotasi refresh lalu pemakaian ulang mematikan refresh & access token lama', async () => {
    const pertama = await http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: dispatcherRefresh });
    expect(pertama.status).toBe(200);
    const refreshBaru = pertama.body.data.refreshToken as string;
    expect(refreshBaru).not.toBe(dispatcherRefresh);

    const ulang = await http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: dispatcherRefresh });
    expectErrorEnvelope(ulang, 'REFRESH_TOKEN_REUSED', 401);

    // Access token lama ikut mati begitu sesi dicabut.
    const meLama = await http.get('/api/v1/me').set('Authorization', `Bearer ${dispatcherToken}`);
    expectErrorEnvelope(meLama, 'UNAUTHENTICATED', 401);
    expect(meLama.body.error.message).toContain('dicabut');

    // Rantai refresh ikut mati.
    const sesudah = await http.post('/api/v1/auth/refresh').send({ refreshToken: refreshBaru });
    expectErrorEnvelope(sesudah, 'UNAUTHENTICATED', 401);
  });

  it('alur 2FA penuh: setup → enable → challenge → login/2fa', async () => {
    const pertama = await http.post('/api/v1/auth/staff/login').send({
      identifier: 'dispatcher2@contoh.test',
      password: DEMO_PASSWORD,
      device: STAFF_DEVICE,
    });
    expect(pertama.status).toBe(200);
    const token = pertama.body.data.accessToken as string;

    const setup = await http.post('/api/v1/auth/2fa/setup').set('Authorization', `Bearer ${token}`);
    expect(setup.status).toBe(200);
    const secret = setup.body.data.secret as string;
    expect(setup.body.data.otpauthUri).toContain('otpauth://totp/');

    const salah = await http
      .post('/api/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '000000' });
    expectErrorEnvelope(salah, 'TWO_FACTOR_INVALID', 401);

    const benar = await http
      .post('/api/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: generateSync({ secret }) });
    expect(benar.status).toBe(204);

    const kedua = await http.post('/api/v1/auth/staff/login').send({
      identifier: 'dispatcher2@contoh.test',
      password: DEMO_PASSWORD,
      device: STAFF_DEVICE,
    });
    expect(kedua.status).toBe(200);
    expect(kedua.body.data.twoFactorRequired).toBe(true);
    expect(kedua.body.data.accessToken).toBeUndefined();
    const challengeToken = kedua.body.data.challengeToken as string;

    const kodeSalah = await http
      .post('/api/v1/auth/staff/login/2fa')
      .send({ challengeToken, code: '000000' });
    expectErrorEnvelope(kodeSalah, 'TWO_FACTOR_INVALID', 401);

    const kodeBenar = await http
      .post('/api/v1/auth/staff/login/2fa')
      .send({ challengeToken, code: generateSync({ secret }) });
    expect(kodeBenar.status).toBe(200);
    expect(kodeBenar.body.data.accessToken).toEqual(expect.any(String));
  });

  it('warga: minta OTP, daftar, lalu login (kode mock 123456)', async () => {
    const minta = await http
      .post('/api/v1/auth/otp/request')
      .send({ phone: CITIZEN_PHONE, purpose: 'REGISTER' });
    expect(minta.status).toBe(202);

    const daftar = await http.post('/api/v1/auth/citizen/register').send({
      phone: CITIZEN_PHONE,
      otpCode: '123456',
      fullName: 'Warga Uji',
      device: CITIZEN_DEVICE,
    });
    expect(daftar.status).toBe(201);
    expect(daftar.body.data.accessToken).toEqual(expect.any(String));
    expect(daftar.body.data.user.userType).toBe('CITIZEN');

    // Kode OTP sudah terpakai: pendaftaran kedua gagal sebelum cek nomor ganda.
    const daftarUlang = await http.post('/api/v1/auth/citizen/register').send({
      phone: CITIZEN_PHONE,
      otpCode: '123456',
      fullName: 'Warga Uji 2',
      device: CITIZEN_DEVICE,
    });
    expectErrorEnvelope(daftarUlang, 'OTP_INVALID', 401);

    const mintaLogin = await http
      .post('/api/v1/auth/otp/request')
      .send({ phone: CITIZEN_PHONE, purpose: 'LOGIN' });
    expect(mintaLogin.status).toBe(202);

    const loginSalah = await http.post('/api/v1/auth/citizen/login').send({
      phone: CITIZEN_PHONE,
      otpCode: '999999',
      device: CITIZEN_DEVICE,
    });
    expectErrorEnvelope(loginSalah, 'OTP_INVALID', 401);

    const login = await http.post('/api/v1/auth/citizen/login').send({
      phone: CITIZEN_PHONE,
      otpCode: '123456',
      device: CITIZEN_DEVICE,
    });
    expect(login.status).toBe(200);
    expect(login.body.data.user.userType).toBe('CITIZEN');
  });
});
