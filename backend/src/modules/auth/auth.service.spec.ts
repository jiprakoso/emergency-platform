import { JwtService } from '@nestjs/jwt';
import { generateSync } from 'otplib';
import { AuthService, TokenPair } from './auth.service';
import { PasswordService } from './providers/password.service';
import { TotpService } from './providers/totp.service';
import { TokenService } from './providers/token.service';
import { OtpService } from './providers/otp.service';
import { MockOtpProvider } from './providers/mock-otp.provider';
import { SessionService, sessionRevokedRedisKey } from './providers/session.service';
import { StaffLoginDto } from './dto/auth.dto';
import { User } from '../../database/entities/user.entity';
import { Role } from '../../database/entities/role.entity';
import { UserRole } from '../../database/entities/user-role.entity';
import { StaffProfile } from '../../database/entities/staff-profile.entity';
import { AuthSession } from '../../database/entities/auth-session.entity';
import { DeviceToken } from '../../database/entities/device-token.entity';
import { OtpRequest } from '../../database/entities/otp-request.entity';
import { ClockService } from '../../common/clock/clock.service';
import { AppError } from '../../common/errors/app-error';
import { PermissionService } from '../permissions/permission.service';
import { DeviceService } from '../me/device.service';
import { RegionLookupService } from '../me/region-lookup.service';
import {
  FakeRedis,
  FakeRepository,
  asRedis,
  asRepository,
  catchError,
  fakeConfig,
} from '../../testing/fakes';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const EMAIL = 'dispatcher1@contoh.test';
const PHONE = '0800-0000-1003';
const PASSWORD = 'Contoh#2026';
const DEVICE: StaffLoginDto['device'] = {
  platform: 'WEB',
  appFlavor: 'STAFF',
  appVersion: '1.0.0',
};
const CTX = { ipAddress: '127.0.0.1', userAgent: 'jest' };

type AuthFixture = {
  auth: AuthService;
  users: FakeRepository<User>;
  sessions: FakeRepository<AuthSession>;
  tokens: TokenService;
  redis: FakeRedis;
  password: PasswordService;
};

async function buildAuth(overrides: Partial<User> = {}): Promise<AuthFixture> {
  const password = new PasswordService();
  const clock = new ClockService();

  const base: User = {
    id: USER_ID,
    userType: 'STAFF',
    fullName: 'Dispatcher Rina',
    phone: PHONE,
    phoneVerifiedAt: new Date(),
    email: EMAIL,
    passwordHash: await password.hash(PASSWORD),
    twoFactorEnabled: false,
    twoFactorSecret: null,
    mustChangePassword: false,
    homeLocation: null,
    homeAddress: null,
    homeRegionId: null,
    homeRegion: null,
    status: 'ACTIVE',
    reputationScore: 0,
    lastLoginAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const user: User = Object.assign(base, overrides);

  const users = new FakeRepository<User>({ rows: [user] });
  const roles = new FakeRepository<Role>();
  const userRoles = new FakeRepository<UserRole>();
  const staffProfiles = new FakeRepository<StaffProfile>();
  const authSessions = new FakeRepository<AuthSession>();
  const deviceTokens = new FakeRepository<DeviceToken>();
  const otpRequests = new FakeRepository<OtpRequest>();
  const redis = new FakeRedis();

  const totpConfig = fakeConfig({ TOTP_ENCRYPTION_KEY: 'kunci-rahasia-uji-totp-sampel' });
  const totp = new TotpService(totpConfig);
  const tokens = new TokenService(
    new JwtService({
      secret: 'rahasia-uji-jwt',
      signOptions: { issuer: 'emergency-platform' },
    }),
    fakeConfig({
      ACCESS_TOKEN_TTL_SECONDS: 900,
      CITIZEN_REFRESH_TTL_SECONDS: 30 * 24 * 60 * 60,
      STAFF_REFRESH_TTL_SECONDS: 12 * 60 * 60,
      TWO_FACTOR_CHALLENGE_TTL_SECONDS: 300,
    }),
  );
  const otp = new OtpService(
    new MockOtpProvider(),
    asRepository(otpRequests),
    fakeConfig({ OTP_TTL_SECONDS: 300, OTP_RESEND_AFTER_SECONDS: 60 }),
    clock,
  );
  const sessions = new SessionService(
    asRepository(authSessions),
    asRepository(deviceTokens),
    clock,
    asRedis(redis),
  );

  const permissionService = {
    getRoles: jest.fn(async () => ['DISPATCHER']),
  } as unknown as PermissionService;
  const deviceService = { register: jest.fn(async () => null) } as unknown as DeviceService;
  const regionLookup = {
    resolve: jest.fn(async () => ({ inServiceArea: false, district: null, village: null })),
  } as unknown as RegionLookupService;

  const auth = new AuthService(
    asRepository(users),
    asRepository(roles),
    asRepository(userRoles),
    asRepository(staffProfiles),
    password,
    totp,
    tokens,
    otp,
    sessions,
    permissionService,
    deviceService,
    regionLookup,
    clock,
  );

  return { auth, users, sessions: authSessions, tokens, redis, password };
}

const LOGIN_DTO: StaffLoginDto = { identifier: EMAIL, password: PASSWORD, device: DEVICE };

function isTokenPair(value: unknown): value is TokenPair {
  return typeof value === 'object' && value !== null && 'accessToken' in value;
}

describe('AuthService — login staf', () => {
  it('mengeluarkan pasangan token tanpa menaruh permission di dalam token', async () => {
    const { auth, tokens } = await buildAuth();

    const result = await auth.staffLogin(LOGIN_DTO, CTX);
    expect(isTokenPair(result)).toBe(true);
    if (!isTokenPair(result)) return;

    expect(result.refreshToken).toMatch(/^r1\./);
    expect(result.user.roles).toEqual(['DISPATCHER']);

    const payload = tokens.verifyAccessToken(result.accessToken);
    expect(payload.sub).toBe(USER_ID);
    expect(payload.userType).toBe('STAFF');
    expect(payload.roles).toEqual(['DISPATCHER']);
    expect(payload).not.toHaveProperty('permissions');

    expect(result.accessTokenExpiresIn).toBe(900);
    expect(result.refreshTokenExpiresIn).toBe(12 * 60 * 60);
  });

  it('menolak kata sandi salah', async () => {
    const { auth } = await buildAuth();
    const err = await catchError(auth.staffLogin({ ...LOGIN_DTO, password: 'salah' }, CTX));
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('UNAUTHENTICATED');
    expect((err as AppError).getStatus()).toBe(401);
  });

  it('menolak akun yang ditangguhkan', async () => {
    const { auth } = await buildAuth({ status: 'SUSPENDED' });
    const err = await catchError(auth.staffLogin(LOGIN_DTO, CTX));
    expect(err.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('login dengan 2FA aktif menghasilkan challenge, bukan token akses', async () => {
    const { auth, tokens } = await buildAuth({ twoFactorEnabled: true });

    const result = await auth.staffLogin(LOGIN_DTO, CTX);

    expect(isTokenPair(result)).toBe(false);
    if (isTokenPair(result)) return;
    expect(result.twoFactorRequired).toBe(true);
    expect(result.challengeToken).toEqual(expect.any(String));

    const challenge = tokens.verifyTwoFactorChallenge(result.challengeToken);
    expect(challenge.sub).toBe(USER_ID);
    expect(challenge.device).toEqual(DEVICE);
  });
});

describe('AuthService — 2FA TOTP', () => {
  it('setup menyimpan rahasia terenkripsi, bukan plaintext', async () => {
    const { auth, users } = await buildAuth();

    const setup = await auth.setupTwoFactor(USER_ID);

    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUri).toContain('otpauth://totp/');
    const stored = users.rows[0].twoFactorSecret;
    expect(stored).toMatch(/^enc:v1\./);
    expect(stored).not.toContain(setup.secret);
    expect(users.rows[0].twoFactorEnabled).toBe(false);
  });

  it('enable menolak kode salah lalu menerima kode benar', async () => {
    const { auth, users } = await buildAuth();
    const { secret } = await auth.setupTwoFactor(USER_ID);

    const wrong = await catchError(auth.enableTwoFactor(USER_ID, '000000'));
    expect(wrong.code).toBe('TWO_FACTOR_INVALID');
    expect(users.rows[0].twoFactorEnabled).toBe(false);

    await expect(auth.enableTwoFactor(USER_ID, generateSync({ secret }))).resolves.toBeUndefined();
    expect(users.rows[0].twoFactorEnabled).toBe(true);
  });

  it('enable tanpa pendaftaran dahulu ditolak', async () => {
    const { auth } = await buildAuth();
    const err = await catchError(auth.enableTwoFactor(USER_ID, '123456'));
    expect(err.code).toBe('TWO_FACTOR_INVALID');
  });

  it('login/2fa menerima kode benar dan menolak kode salah', async () => {
    const { auth, users } = await buildAuth();
    const { secret } = await auth.setupTwoFactor(USER_ID);
    await auth.enableTwoFactor(USER_ID, generateSync({ secret }));

    const login = await auth.staffLogin(LOGIN_DTO, CTX);
    expect(isTokenPair(login)).toBe(false);
    if (isTokenPair(login)) return;
    expect(login.twoFactorRequired).toBe(true);

    const wrong = await catchError(
      auth.staffLogin2fa({ challengeToken: login.challengeToken, code: '000000' }, CTX),
    );
    expect(wrong.code).toBe('TWO_FACTOR_INVALID');

    const ok = await auth.staffLogin2fa(
      { challengeToken: login.challengeToken, code: generateSync({ secret }) },
      CTX,
    );
    expect(isTokenPair(ok)).toBe(true);
    if (!isTokenPair(ok)) return;
    expect(ok.refreshToken).toMatch(/^r1\./);
    expect(users.rows[0].lastLoginAt).not.toBeNull();
  });

  it('login/2fa menolak challenge yang tidak valid', async () => {
    const { auth } = await buildAuth({ twoFactorEnabled: true });
    const err = await catchError(
      auth.staffLogin2fa({ challengeToken: 'r1.bukan-jwt', code: '123456' }, CTX),
    );
    expect(err.code).toBe('TWO_FACTOR_INVALID');
  });

  it('login/2fa ditolak bila rahasia 2FA tidak ada pada akun', async () => {
    const { auth } = await buildAuth({ twoFactorEnabled: true, twoFactorSecret: null });
    const login = await auth.staffLogin(LOGIN_DTO, CTX);
    if (isTokenPair(login)) throw new Error('diharapkan challenge, bukan token');

    const err = await catchError(
      auth.staffLogin2fa({ challengeToken: login.challengeToken, code: '123456' }, CTX),
    );
    expect(err.code).toBe('TWO_FACTOR_INVALID');
  });
});

describe('AuthService — rotasi refresh & pemakaian ulang', () => {
  it('refresh mengeluarkan token baru dan memutakhirkannya', async () => {
    const { auth, sessions } = await buildAuth();
    const first = await auth.staffLogin(LOGIN_DTO, CTX);
    if (!isTokenPair(first)) throw new Error('diharapkan token pair');

    const second = await auth.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.user.id).toBe(USER_ID);
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0].revokedAt).toBeNull();
    expect(sessions.rows[0].previousTokenHash).not.toBeNull();
  });

  it('memakai ulang refresh token lama mencabut sesi (REFRESH_TOKEN_REUSED)', async () => {
    const { auth, sessions, redis } = await buildAuth();
    const first = await auth.staffLogin(LOGIN_DTO, CTX);
    if (!isTokenPair(first)) throw new Error('diharapkan token pair');
    const second = await auth.refresh(first.refreshToken);

    const err = await catchError(auth.refresh(first.refreshToken));

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('REFRESH_TOKEN_REUSED');
    expect((err as AppError).getStatus()).toBe(401);
    expect(sessions.rows[0].revokedAt).not.toBeNull();
    // Access token yang sudah terbit ikut dicabut di Redis.
    expect(await redis.get(sessionRevokedRedisKey(sessions.rows[0].id))).toBe('1');

    // Rantai refresh ikut mati: token terakhir tidak bisa dipakai lagi.
    const after = await catchError(auth.refresh(second.refreshToken));
    expect(after.code).toBe('UNAUTHENTICATED');
  });

  it('menolak refresh token yang tidak dikenal', async () => {
    const { auth } = await buildAuth();
    const err = await catchError(auth.refresh('r1.tidak-ada'));
    expect(err.code).toBe('UNAUTHENTICATED');
  });
});
