/**
 * Pengganti `@nestjs/terminus` untuk tes (lihat `moduleNameMapper` pada
 * `jest.config.js`). Paket aslinya hanya ESM dan tidak bisa di-parse Jest;
 * simbol yang diekspor hanya dipakai indikator kesehatan Redis, yang tidak
 * diuji pada suite ini.
 */
export class TerminusModule {}

export class HealthIndicator {}

export class HealthIndicatorService {}

export type HealthIndicatorResult = Record<string, unknown>;
