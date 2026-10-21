import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { hashPayload } from '../crypto/hash';
import { AppError } from '../errors/app-error';

const TTL_SECONDS = 24 * 60 * 60; // 24 jam (REST §1.3)

type StoredEntry = {
  payloadHash: string;
  status: number;
  body: unknown;
};

/**
 * Idempotensi berbasis `Idempotency-Key` untuk aksi yang mengubah status (REST §1.3).
 * Kunci sama + isi sama => respons tersimpan. Kunci sama + isi beda => 422 IDEMPOTENCY_CONFLICT.
 * (Laporan warga memakai `clientReportId` di tingkat report, bukan mekanisme ini.)
 */
@Injectable()
export class IdempotencyService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  private key(scope: string, key: string): string {
    return `idem:${scope}:${key}`;
  }

  async lookup(scope: string, key: string, payload: unknown): Promise<StoredEntry | null> {
    const raw = await this.redis.get(this.key(scope, key));
    if (!raw) return null;
    const entry = JSON.parse(raw) as StoredEntry;
    if (entry.payloadHash !== hashPayload(payload)) {
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        'Kunci idempotensi yang sama dipakai dengan isi permintaan berbeda.',
      );
    }
    return entry;
  }

  async store(
    scope: string,
    key: string,
    payload: unknown,
    status: number,
    body: unknown,
  ): Promise<void> {
    const entry: StoredEntry = { payloadHash: hashPayload(payload), status, body };
    await this.redis.set(this.key(scope, key), JSON.stringify(entry), 'EX', TTL_SECONDS);
  }
}
