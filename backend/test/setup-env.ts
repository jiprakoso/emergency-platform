/**
 * Dijalankan di tiap worker tes e2e **sebelum** kerangka tes (setupFiles):
 * arahkan aplikasi ke basis data uji dan senyapkan log.
 *
 * Nilai ini dimenangkan terhadap `.env` karena `@nestjs/config`/dotenv tidak
 * menimpa variabel yang sudah ada di lingkungan proses.
 */
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.E2E_DB_NAME ?? 'emergency_platform_test';
process.env.LOG_LEVEL = 'silent';
