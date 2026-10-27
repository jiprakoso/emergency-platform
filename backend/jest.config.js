/**
 * Konfigurasi Jest (ts-jest) untuk backend.
 *
 * Tes bersifat hermetic: memakai fake repository/redis di `src/testing`,
 * tanpa Postgres/Redis sungguhan, sehingga `make test` bisa dijalankan
 * di mana pun tanpa infrastruktur.
 *
 * Catatan pnpm: sebagian paket hanya memuat ESM (`@scure/base`, `@noble/hashes`,
 * `@otplib/*`) dan tetap ditransformasi; `@nestjs/terminus` dipetakan ke stub
 * karena ESM-only dan tidak terlibat pada jalur yang diuji. Paket lain di
 * `node_modules` dibiarkan apa adanya (CJS).
 */
const ESM_PACKAGES = '(?:(?:@scure|@noble|@otplib|otplib)(?:/|\\+))';

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true } }],
  },
  transformIgnorePatterns: [
    `/node_modules/(?!\\.pnpm/)(?!${ESM_PACKAGES})`,
    `/node_modules/\\.pnpm/(?!${ESM_PACKAGES})`,
  ],
  moduleNameMapper: {
    // Paket ESM-only yang tidak terlibat pada jalur yang diuji.
    '^@nestjs/terminus$': '<rootDir>/src/testing/terminus.stub.ts',
  },
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/testing/**'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
