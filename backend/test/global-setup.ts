import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { Client } from 'pg';

const TEST_DB = process.env.E2E_DB_NAME ?? 'emergency_platform_test';

/** Jalankan skrip backend (migrasi/seed) terhadap basis data uji. */
function runScript(script: string): void {
  execFileSync('corepack', ['pnpm', script], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DB_NAME: TEST_DB, NODE_ENV: 'test' },
    stdio: 'inherit',
  });
}

/**
 * Persiapan sekali per run `test:e2e`:
 * 1. pastikan infrastruktur dev hidup (pesan galat yang jelas bila tidak);
 * 2. buat `emergency_platform_test` bila belum ada;
 * 3. jalankan migrasi + `seed:base` (idempoten) terhadap DB uji.
 *
 * Penghitung laju yang identitasnya tetap (mis. OTP per-IP) dibersihkan di
 * `resetLocalRateLimits` tiap suite, bukan di sini.
 */
export default async function globalSetup(): Promise<void> {
  const client = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: 'postgres',
  });

  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      'Uji e2e membutuhkan infrastruktur dev — jalankan `make up` lebih dulu. ' +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
  if ((existing.rowCount ?? 0) === 0) {
    await client.query(`CREATE DATABASE "${TEST_DB}"`);
  }
  await client.end();

  runScript('migration:run');
  runScript('seed:base');
}
