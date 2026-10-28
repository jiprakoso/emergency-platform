import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, validateSync } from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  PORT: number = 3000;

  @IsString()
  LOG_LEVEL: string = 'info';

  @IsString()
  DB_HOST: string = 'localhost';

  @IsNumber()
  DB_PORT: number = 5432;

  @IsString()
  DB_USERNAME: string = 'postgres';

  @IsString()
  DB_PASSWORD: string = 'postgres';

  @IsString()
  DB_NAME: string = 'emergency_platform';

  @IsString()
  REDIS_HOST: string = 'localhost';

  @IsNumber()
  REDIS_PORT: number = 6379;

  @IsString()
  MINIO_ENDPOINT: string = 'localhost';

  @IsNumber()
  MINIO_PORT: number = 9000;

  @IsString()
  MINIO_ACCESS_KEY: string = 'minioadmin';

  @IsString()
  MINIO_SECRET_KEY: string = 'minioadmin';

  @IsString()
  MINIO_BUCKET: string = 'attachments';

  /**
   * Nilai boolean env dikirim sebagai string (`'true'`/`'false'`). Dipertahankan
   * sebagai string karena `enableImplicitConversion` mengubah `Boolean('false')`
   * menjadi `true`; konversi dilakukan di tempat pemakaian.
   */
  @IsOptional()
  @IsString()
  MINIO_USE_SSL?: string = 'false';

  @IsString()
  AUTH_JWT_SECRET: string = 'dev-jwt-secret-change-me';

  @IsString()
  AUTH_REFRESH_SECRET: string = 'dev-refresh-secret-change-me';

  /** Kunci enkripsi rahasia TOTP (handoff §9.5). Wajib diisi: aplikasi gagal start bila kosong. */
  @IsString()
  TOTP_ENCRYPTION_KEY: string = 'dev-totp-encryption-key-change-me';

  @IsString()
  @IsOptional()
  OTP_PROVIDER?: string = 'mock';

  @IsNumber()
  @IsOptional()
  OTP_TTL_SECONDS: number = 300;

  @IsNumber()
  @IsOptional()
  OTP_RESEND_AFTER_SECONDS: number = 60;

  @IsNumber()
  @IsOptional()
  ACCESS_TOKEN_TTL_SECONDS: number = 900;

  @IsNumber()
  @IsOptional()
  CITIZEN_REFRESH_TTL_SECONDS: number = 30 * 24 * 60 * 60;

  @IsNumber()
  @IsOptional()
  STAFF_REFRESH_TTL_SECONDS: number = 12 * 60 * 60;

  @IsNumber()
  @IsOptional()
  TWO_FACTOR_CHALLENGE_TTL_SECONDS: number = 300;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
