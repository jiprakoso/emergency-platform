import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';
import { AuthedRequest } from './auth.types';
import { IS_PUBLIC_KEY } from './auth.decorators';
import { TokenService } from './providers/token.service';
import { AppError } from '../../common/errors/app-error';

/**
 * Guard global: verifikasi access token kecuali route ditandai `@Public()`.
 * Route publik yang mengirim token tetap mengisi `req.user` bila valid,
 * sehingga controller dapat membedakan (mis. `GET /config/public`).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @InjectRedis() private readonly redis: Redis,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context
      .switchToHttp()
      .getRequest<AuthedRequest & { headers: Record<string, unknown> }>();
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : null;

    if (!token) {
      if (isPublic) return true;
      throw AppError.unauthenticated('Token akses tidak ada.');
    }

    try {
      const payload = this.tokens.verifyAccessToken(token);
      const revoked = await this.redis.get(`session:revoked:${payload.sid}`);
      if (revoked) {
        throw AppError.unauthenticated('Sesi sudah dicabut.');
      }
      // Akun nonaktif/ditangguhkan langsung ditolak meski access token belum kedaluwarsa
      // (syarat selesai §7.2 `auth`, S7). Pencarian PK, tanpa cache agar berlaku seketika.
      const [account] = await this.dataSource.query<Array<{ status: string }>>(
        'SELECT status FROM users WHERE id = $1',
        [payload.sub],
      );
      if (!account || account.status !== 'ACTIVE') {
        throw new AppError('ACCOUNT_DEACTIVATED', 'Akun tidak aktif.');
      }
      req.user = {
        userId: payload.sub,
        sessionId: payload.sid,
        userType: payload.userType,
        roles: payload.roles ?? [],
        orgId: payload.orgId,
        unitId: payload.unitId,
      };
    } catch (err) {
      if (isPublic) return true;
      if (err instanceof AppError) throw err;
      throw AppError.unauthenticated('Token akses tidak valid atau kedaluwarsa.');
    }

    return true;
  }
}
