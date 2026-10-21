import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from './common/config/config.module';
import { LoggerModule } from './common/logger/logger.module';
import { ClockModule } from './common/clock/clock.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './database/redis.module';
import { HealthModule } from './modules/health/health.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { PermissionGuard } from './modules/permissions/permission.guard';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { MeModule } from './modules/me/me.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    ClockModule,
    DatabaseModule,
    RedisModule,
    IdempotencyModule,
    RateLimitModule,
    PermissionsModule,
    AuthModule,
    MeModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
