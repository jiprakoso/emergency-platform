const path = require('node:path');

const base = require('../jest.config');

/**
 * Konfigurasi Jest untuk uji e2e (HTTP lewat supertest, Postgres/Redis nyata).
 *
 * Berbeda dengan tes unit, suite ini membutuhkan infrastruktur dev (`make up`)
 * dan basis data uji `emergency_platform_test` — disiapkan otomatis oleh
 * `global-setup.ts` (buat DB → migrasi → seed:base).
 */
module.exports = {
  ...base,
  rootDir: path.resolve(__dirname, '..'),
  roots: ['<rootDir>/test'],
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 120000,
  // Berbagi infrastruktur dev: jalankan satu per satu agar penghitung laju dan
  // sesi tidak saling mengganggu antar berkas tes.
  maxWorkers: 1,
};
