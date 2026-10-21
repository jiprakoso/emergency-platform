import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';

export type AccessTokenPayload = {
  sub: string;
  sid: string;
  userType: 'CITIZEN' | 'STAFF';
  roles: string[];
  orgId?: string;
  unitId?: string;
};

/**
 * Access token (JWT, 15 menit, REST §2) + refresh token (opaque, rotasi).
 * Permission TIDAK dimasukkan (dihitung server-side).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  get accessTtlSeconds(): number {
    return Number(this.config.get('ACCESS_TOKEN_TTL_SECONDS', 900));
  }

  refreshTtlSeconds(userType: 'CITIZEN' | 'STAFF'): number {
    return userType === 'CITIZEN'
      ? Number(this.config.get('CITIZEN_REFRESH_TTL_SECONDS', 30 * 24 * 60 * 60))
      : Number(this.config.get('STAFF_REFRESH_TTL_SECONDS', 12 * 60 * 60));
  }

  signAccessToken(payload: AccessTokenPayload): string {
    return this.jwt.sign(payload, { expiresIn: this.accessTtlSeconds });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwt.verify<AccessTokenPayload>(token);
  }

  /** Refresh token opaque berawalan `r1.` (contoh REST §5.1). */
  generateRefreshToken(): string {
    return `r1.${randomBytes(32).toString('base64url')}`;
  }

  /** Challenge token 2FA (JWT pendek). Berisi userId + konteks perangkat. */
  signTwoFactorChallenge(payload: {
    sub: string;
    device: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): string {
    return this.jwt.sign(
      { ...payload, purpose: '2fa' },
      { expiresIn: Number(this.config.get('TWO_FACTOR_CHALLENGE_TTL_SECONDS', 300)) },
    );
  }

  verifyTwoFactorChallenge(token: string): {
    sub: string;
    device: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
  } {
    const payload = this.jwt.verify<{
      sub: string;
      device: unknown;
      ipAddress?: string | null;
      userAgent?: string | null;
      purpose?: string;
    }>(token);
    if (payload.purpose !== '2fa') {
      throw new Error('not a 2fa challenge');
    }
    return payload;
  }
}
