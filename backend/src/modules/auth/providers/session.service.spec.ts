import { SessionService } from './session.service';
import { AuthSession } from '../../../database/entities/auth-session.entity';
import { DeviceToken } from '../../../database/entities/device-token.entity';
import { ClockService } from '../../../common/clock/clock.service';
import { sha256Hex } from '../../../common/crypto/hash';
import { AppError } from '../../../common/errors/app-error';
import { FakeRepository, asRepository, catchError } from '../../../testing/fakes';

const USER_ID = 'user-staf-1';
const DEVICE_ID = 'device-1';
const CTX = {
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
  deviceTokenId: DEVICE_ID,
  devicePlatform: 'WEB',
  appFlavor: 'STAFF',
  appVersion: '1.0.0',
};

function buildService() {
  const sessions = new FakeRepository<AuthSession>();
  const devices = new FakeRepository<DeviceToken>({ rows: [{ id: DEVICE_ID }] as DeviceToken[] });
  const service = new SessionService(
    asRepository(sessions),
    asRepository(devices),
    new ClockService(),
  );
  return { service, sessions, devices };
}

describe('SessionService', () => {
  it('menyimpan hash refresh token, bukan token plaintext', async () => {
    const { service, sessions } = buildService();
    const token = 'r1.kulit-manusia';

    const row = await service.create(USER_ID, token, 12 * 60 * 60, CTX);

    expect(row.refreshTokenHash).toBe(sha256Hex(token));
    expect(JSON.stringify(sessions.rows)).not.toContain(token);
    expect(row.revokedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.deviceTokenId).toBe(DEVICE_ID);
  });

  it('merotasi refresh token: hash baru disimpan, hash lama ditandai', async () => {
    const { service, sessions } = buildService();
    const oldToken = 'r1.lama';
    const newToken = 'r1.baru';
    await service.create(USER_ID, oldToken, 43200, CTX);

    const rotated = await service.rotate(oldToken, newToken);

    expect(rotated.refreshTokenHash).toBe(sha256Hex(newToken));
    expect(rotated.previousTokenHash).toBe(sha256Hex(oldToken));
    expect(rotated.lastUsedAt).not.toBeNull();
    expect(sessions.rows[0].refreshTokenHash).toBe(sha256Hex(newToken));
    expect(sessions.rows[0].previousTokenHash).toBe(sha256Hex(oldToken));
    expect(sessions.rows[0].revokedAt).toBeNull();
  });

  it('mendeteksi pemakaian ulang token lama dan mencabut seluruh sesi', async () => {
    const { service, sessions } = buildService();
    const oldToken = 'r1.lama';
    const newToken = 'r1.baru';
    await service.create(USER_ID, oldToken, 43200, CTX);
    await service.rotate(oldToken, newToken);

    const err = await catchError(service.rotate(oldToken, 'r1.palsu'));

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('REFRESH_TOKEN_REUSED');
    expect((err as AppError).getStatus()).toBe(401);
    expect(sessions.rows[0].revokedAt).not.toBeNull();

    // Token hasil rotasi terakhir ikut mati karena sesi sudah dicabut.
    const followUp = await catchError(service.rotate(newToken, 'r1.lanjut'));
    expect(followUp.code).toBe('UNAUTHENTICATED');
  });

  it('menolak refresh token yang tidak dikenal', async () => {
    const { service } = buildService();
    await service.create(USER_ID, 'r1.ada', 43200, CTX);

    const err = await catchError(service.rotate('r1.tidak-ada', 'r1.baru'));

    expect(err.code).toBe('UNAUTHENTICATED');
    expect((err as AppError).getStatus()).toBe(401);
  });

  it('mencabut sesi yang sudah kedaluwarsa saat dipakai rotasi', async () => {
    const { service, sessions } = buildService();
    await service.create(USER_ID, 'r1.kedaluwarsa', -1, CTX);

    const err = await catchError(service.rotate('r1.kedaluwarsa', 'r1.baru'));

    expect(err.code).toBe('UNAUTHENTICATED');
    expect(sessions.rows[0].revokedAt).not.toBeNull();
  });

  it('logout mencabut sesi dan token perangkat terkait', async () => {
    const { service, sessions, devices } = buildService();
    const session = await service.create(USER_ID, 'r1.logout', 43200, CTX);

    await service.logout(session);

    expect(sessions.rows[0].revokedAt).not.toBeNull();
    expect(devices.rows[0].revokedAt).not.toBeNull();
  });

  it('hanya sesi aktif yang terlihat', async () => {
    const { service, sessions } = buildService();
    const active = await service.create(USER_ID, 'r1.aktif', 43200, CTX);
    await service.create(USER_ID, 'r1.cabut', 43200, CTX);
    await service.revokeSession(sessions.rows[1].id);

    const listed = await service.listActive(USER_ID);
    expect(listed.map((s) => s.id)).toEqual([active.id]);

    expect(await service.getActive(USER_ID, active.id)).not.toBeNull();
    expect(await service.getActive(USER_ID, sessions.rows[1].id)).toBeNull();
  });
});
