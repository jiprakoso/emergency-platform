import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AuthSession } from '../../../database/entities/auth-session.entity';
import { DeviceToken } from '../../../database/entities/device-token.entity';
import { sha256Hex } from '../../../common/crypto/hash';
import { ClockService } from '../../../common/clock/clock.service';
import { AppError } from '../../../common/errors/app-error';

export type SessionContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceTokenId?: string | null;
  devicePlatform?: string | null;
  appFlavor?: string | null;
  appVersion?: string | null;
};

export type IssuedRefresh = {
  session: AuthSession;
  refreshToken: string;
};

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(AuthSession) private readonly sessions: Repository<AuthSession>,
    @InjectRepository(DeviceToken) private readonly devices: Repository<DeviceToken>,
    private readonly clock: ClockService,
  ) {}

  async create(
    userId: string,
    refreshToken: string,
    refreshTtlSeconds: number,
    ctx: SessionContext,
  ): Promise<AuthSession> {
    const now = this.clock.now();
    const row = this.sessions.create({
      userId,
      deviceTokenId: ctx.deviceTokenId ?? null,
      refreshTokenHash: sha256Hex(refreshToken),
      previousTokenHash: null,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      platform: ctx.devicePlatform ?? null,
      appFlavor: ctx.appFlavor ?? null,
      appVersion: ctx.appVersion ?? null,
      expiresAt: new Date(now.getTime() + refreshTtlSeconds * 1000),
      revokedAt: null,
      lastUsedAt: now,
      createdAt: now,
    });
    return this.sessions.save(row);
  }

  /**
   * Rotasi refresh token (REST §2). Pemakaian ulang token lama =
   * seluruh sesi dicabut dan `REFRESH_TOKEN_REUSED`.
   */
  async rotate(refreshToken: string, newRefreshToken: string): Promise<AuthSession> {
    const hash = sha256Hex(refreshToken);
    const now = this.clock.now();

    const session = await this.sessions.findOne({
      where: { refreshTokenHash: hash, revokedAt: IsNull() },
      select: {
        id: true,
        userId: true,
        deviceTokenId: true,
        refreshTokenHash: true,
        previousTokenHash: true,
        expiresAt: true,
      },
    });

    if (!session) {
      // Mungkin token lama (sudah dirotasi) dipakai ulang → deteksi reuse.
      const reused = await this.sessions.findOne({
        where: { previousTokenHash: hash, revokedAt: IsNull() },
        select: { id: true, userId: true },
      });
      if (reused) {
        await this.revokeSession(reused.id);
        throw new AppError(
          'REFRESH_TOKEN_REUSED',
          'Refresh token sudah dipakai. Sesi dicabut, silakan masuk kembali.',
        );
      }
      throw AppError.unauthenticated('Refresh token tidak valid atau sudah kedaluwarsa.');
    }

    if (session.expiresAt.getTime() < now.getTime()) {
      await this.revokeSession(session.id);
      throw AppError.unauthenticated('Refresh token sudah kedaluwarsa.');
    }

    await this.sessions.update(
      { id: session.id },
      {
        refreshTokenHash: sha256Hex(newRefreshToken),
        previousTokenHash: hash,
        lastUsedAt: now,
      },
    );
    return { ...session, refreshTokenHash: sha256Hex(newRefreshToken), previousTokenHash: hash };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.sessions.update(
      { id: sessionId, revokedAt: IsNull() },
      { revokedAt: this.clock.now() },
    );
  }

  /** Logout: cabut sesi + token FCM perangkat itu (REST §5.1). */
  async logout(session: AuthSession): Promise<void> {
    await this.revokeSession(session.id);
    if (session.deviceTokenId) {
      await this.devices.update(
        { id: session.deviceTokenId },
        { revokedAt: this.clock.now() },
      );
    }
  }

  async listActive(userId: string): Promise<AuthSession[]> {
    return this.sessions.find({
      where: { userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
      select: {
        id: true,
        deviceTokenId: true,
        ipAddress: true,
        userAgent: true,
        platform: true,
        appFlavor: true,
        appVersion: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    });
  }

  async getActive(userId: string, sessionId: string): Promise<AuthSession | null> {
    return this.sessions.findOne({
      where: { id: sessionId, userId, revokedAt: IsNull() },
    });
  }

  /** Butuh hash untuk logout — ambil termasuk kolom `select:false`. */
  async findActiveByRefreshToken(refreshToken: string): Promise<AuthSession | null> {
    return this.sessions.findOne({
      where: { refreshTokenHash: sha256Hex(refreshToken), revokedAt: IsNull() },
    });
  }

  async getSessionWithHash(sessionId: string): Promise<AuthSession | null> {
    return this.sessions
      .createQueryBuilder('s')
      .addSelect(['s.refreshTokenHash', 's.previousTokenHash'])
      .where('s.id = :sessionId', { sessionId })
      .getOne();
  }
}
