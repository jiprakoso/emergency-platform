import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenService } from './providers/token.service';
import { sessionRevokedRedisKey } from './providers/session.service';
import { AppError } from '../../common/errors/app-error';
import { AuthedRequest } from './auth.types';
import { FakeRedis, asRedis, catchError, fakeConfig } from '../../testing/fakes';

const USER_ID = 'user-staf-1';
const SESSION_ID = 'sesi-1';

function buildGuard(isPublic: boolean, accountStatus: string | null = 'ACTIVE') {
  const reflector = {
    getAllAndOverride: jest.fn(() => isPublic),
  } as unknown as Reflector;
  const tokens = new TokenService(
    new JwtService({
      secret: 'rahasia-uji-jwt',
      signOptions: { issuer: 'emergency-platform' },
    }),
    fakeConfig({
      ACCESS_TOKEN_TTL_SECONDS: 900,
      CITIZEN_REFRESH_TTL_SECONDS: 30 * 24 * 60 * 60,
      STAFF_REFRESH_TTL_SECONDS: 12 * 60 * 60,
    }),
  );
  const redis = new FakeRedis();
  // Hanya `SELECT status FROM users` yang dipakai guard; null = pengguna tidak ada.
  const dataSource = {
    query: jest.fn(async () => (accountStatus ? [{ status: accountStatus }] : [])),
  } as unknown as DataSource;
  const guard = new JwtAuthGuard(reflector, tokens, asRedis(redis), dataSource);
  return { guard, tokens, redis };
}

function contextFor(token: string | null): { ctx: ExecutionContext; request: AuthedRequest } {
  const request = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as unknown as AuthedRequest & { headers: Record<string, string> };
  const ctx = {
    getHandler: () => (): void => undefined,
    getClass: () => class Handler {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('JwtAuthGuard', () => {
  it('mengisi principal dari access token yang sah', async () => {
    const { guard, tokens } = buildGuard(false);
    const token = tokens.signAccessToken({
      sub: USER_ID,
      sid: SESSION_ID,
      userType: 'STAFF',
      roles: ['DISPATCHER'],
      orgId: 'org-cc',
    });

    const { ctx, request } = contextFor(token);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    expect(request.user).toEqual({
      userId: USER_ID,
      sessionId: SESSION_ID,
      userType: 'STAFF',
      roles: ['DISPATCHER'],
      orgId: 'org-cc',
      unitId: undefined,
    });
  });

  it('menolak access token yang sesinya sudah dicabut di Redis', async () => {
    const { guard, tokens, redis } = buildGuard(false);
    const token = tokens.signAccessToken({
      sub: USER_ID,
      sid: SESSION_ID,
      userType: 'STAFF',
      roles: ['DISPATCHER'],
    });
    await redis.set(sessionRevokedRedisKey(SESSION_ID), '1', 'EX', 86400);

    const err = await catchError(guard.canActivate(contextFor(token).ctx));
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('UNAUTHENTICATED');
    expect((err as AppError).getStatus()).toBe(401);
  });

  it.each([['DEACTIVATED'], ['SUSPENDED'], [null]])(
    'menolak access token yang masih berlaku bila akun %s → 403 ACCOUNT_DEACTIVATED',
    async (status) => {
      const { guard, tokens } = buildGuard(false, status);
      const token = tokens.signAccessToken({ sub: USER_ID, sid: SESSION_ID, userType: 'STAFF', roles: ['RESPONDER'] });
      const { ctx, request } = contextFor(token);
      const err = await catchError(guard.canActivate(ctx));
      expect(err.code).toBe('ACCOUNT_DEACTIVATED');
      expect((err as AppError).getStatus()).toBe(403);
      expect(request.user).toBeUndefined();
    },
  );

  it('rute publik dengan token akun nonaktif tetap terbuka tanpa principal', async () => {
    const { guard, tokens } = buildGuard(true, 'DEACTIVATED');
    const token = tokens.signAccessToken({ sub: USER_ID, sid: SESSION_ID, userType: 'CITIZEN', roles: ['CITIZEN'] });
    const { ctx, request } = contextFor(token);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('melewati rute publik tanpa token', async () => {
    const { guard } = buildGuard(true);
    const { ctx, request } = contextFor(null);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('menolak rute terproteksi tanpa token', async () => {
    const { guard } = buildGuard(false);
    const err = await catchError(guard.canActivate(contextFor(null).ctx));
    expect(err.code).toBe('UNAUTHENTICATED');
  });

  it('menolak access token yang rusak pada rute terproteksi', async () => {
    const { guard } = buildGuard(false);
    const err = await catchError(guard.canActivate(contextFor('bukan-jwt').ctx));
    expect(err.code).toBe('UNAUTHENTICATED');
  });
});
