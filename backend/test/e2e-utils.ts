import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { DEMO_PASSWORD } from '../src/modules/seed/seed-data';

export type Http = ReturnType<typeof request>;

export type ErrorEnvelopeBody = {
  error: { code: string; message: string; details?: unknown[]; requestId?: string };
};

export const STAFF_DEVICE = {
  platform: 'WEB',
  appFlavor: 'STAFF',
  appVersion: '1.0.0',
} as const;

export const CITIZEN_DEVICE = {
  platform: 'ANDROID',
  appFlavor: 'CITIZEN',
  appVersion: '1.0.0',
} as const;

/**
 * Buang aplikasi Nest untuk uji HTTP: perlakuan sama dengan `main.ts`
 * (prefix versi, pipe validasi, filter amplop galat, middleware requestId),
 * tanpa helmet/rate-limit tambahan agar fokus pada perilaku yang diuji.
 */
export async function createTestApp(): Promise<{ app: INestApplication; http: Http }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.use(requestIdMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('api/v1');
  await app.init();
  return { app, http: request(app.getHttpServer()) };
}

export type TokenPairBody = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
  user: { id: string; userType: 'CITIZEN' | 'STAFF'; fullName: string; roles: string[] };
};

/** Login staf dengan kredensial seed; melempar galat jelas bila gagal. */
export async function staffLogin(http: Http, identifier: string): Promise<TokenPairBody> {
  const res = await http
    .post('/api/v1/auth/staff/login')
    .send({ identifier, password: DEMO_PASSWORD, device: STAFF_DEVICE });
  if (res.status !== 200) {
    throw new Error(`login staf gagal (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data as TokenPairBody;
}

/** Assert amplop galat REST §7: kode stabil + pesan + requestId. */
export function expectErrorEnvelope(res: request.Response, code: string, status: number): void {
  expect(res.status).toBe(status);
  expect(res.body.error?.code).toBe(code);
  expect(typeof res.body.error?.message).toBe('string');
  expect(typeof res.body.error?.requestId).toBe('string');
}

/**
 * Bersihkan penghitung laju yang identitasnya tetap antar run (permintaan OTP
 * datang dari IP lokal yang sama). Hanya kunci IP lokal tes — bukan flush
 * seluruh Redis — agar data demo/dev lain tidak tersentuh.
 */
export async function resetLocalRateLimits(app: INestApplication): Promise<void> {
  const redis = app.get<Redis>(getRedisConnectionToken());
  await redis.del('rl:otp:ip:127.0.0.1', 'rl:otp:ip:::ffff:127.0.0.1');
}
