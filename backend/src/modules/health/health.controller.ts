import { Controller, Get, Res } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { ClockService } from '../../common/clock/clock.service';

type CheckState = 'ok' | 'error';

/**
 * Kesehatan (REST §5.14): `/health` liveness, `/health/ready` readiness
 * (database, Redis, object storage) → 200 bila siap, 503 bila ada dependensi
 * bermasalah (kontrak `GETHealthReady`).
 */
@Controller('health')
@Public()
export class HealthController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRedis() private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly clock: ClockService,
  ) {}

  @Get()
  check() {
    return { status: 'ok', timestamp: this.clock.now().toISOString() };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [db, redis, storage] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkStorage(),
    ]);
    const isReady = db === 'ok' && redis === 'ok' && storage === 'ok';
    res.status(isReady ? 200 : 503);
    return {
      status: isReady ? 'ready' : 'not_ready',
      checks: { db, redis, storage },
      timestamp: this.clock.now().toISOString(),
    };
  }

  private async checkDatabase(): Promise<CheckState> {
    try {
      await this.ds.query('SELECT 1');
      return 'ok';
    } catch {
      return 'error';
    }
  }

  private async checkRedis(): Promise<CheckState> {
    try {
      const reply = await this.redis.ping();
      return reply === 'PONG' ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }

  private async checkStorage(): Promise<CheckState> {
    const endpoint = this.config.get<string>('MINIO_ENDPOINT') ?? 'localhost';
    const port = this.config.get<number>('MINIO_PORT') ?? 9000;
    const useSsl = ['true', '1'].includes(String(this.config.get('MINIO_USE_SSL') ?? '').toLowerCase());
    const url = `${useSsl ? 'https' : 'http'}://${endpoint}:${port}/minio/health/live`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return response.ok ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }
}
