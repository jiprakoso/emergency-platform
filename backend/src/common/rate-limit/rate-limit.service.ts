import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { AppError } from '../errors/app-error';
import { RateLimitRule } from './rate-limit.rules';

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Penghitung jendela tetap di Redis (REST §8). Cukup untuk sampel;
 * dapat ditingkatkan ke token bucket tanpa mengubah pemanggil.
 */
@Injectable()
export class RateLimitService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async check(rule: RateLimitRule, identity: string, cost = 1): Promise<RateLimitResult> {
    const key = `rl:${rule.scope}:${identity}`;
    const count = await this.redis.incrby(key, cost);
    if (count === cost) {
      await this.redis.expire(key, rule.windowSeconds);
    }
    const ttl = await this.redis.ttl(key);
    const allowed = count <= rule.limit;
    return {
      allowed,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSeconds: ttl > 0 ? ttl : rule.windowSeconds,
    };
  }

  /** Melempar 429 RATE_LIMITED bila melewati batas. */
  async enforce(rule: RateLimitRule, identity: string, cost = 1): Promise<void> {
    const result = await this.check(rule, identity, cost);
    if (!result.allowed) {
      throw new AppError(
        'RATE_LIMITED',
        'Terlalu banyak permintaan. Coba lagi nanti.',
        undefined,
        undefined,
        { retryAfterSeconds: result.retryAfterSeconds },
      );
    }
  }

  /** Reset penghitung (mis. login staf berhasil). */
  async reset(rule: RateLimitRule, identity: string): Promise<void> {
    await this.redis.del(`rl:${rule.scope}:${identity}`);
  }
}
