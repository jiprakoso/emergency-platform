import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import helmet from 'helmet';
import { parse } from 'yaml';
import { createTestApp, Http } from './e2e-utils';
import { API_DOCS_PATH, setupApiDocs } from '../src/docs/swagger';

/** Swagger UI menyajikan kontrak apa adanya (titik tinjau C1) dan mati di produksi. */
describe('Swagger UI (contracts/openapi.yaml)', () => {
  let app: INestApplication;
  let http: Http;

  beforeAll(async () => {
    // Helmet seperti main.ts agar header CSP yang diuji sama dengan server sungguhan.
    ({ app, http } = await createTestApp((a) => {
      a.use(helmet());
      expect(setupApiDocs(a)).toBe(true);
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  it(`GET /${API_DOCS_PATH}/ → halaman Swagger UI`, async () => {
    const res = await http.get(`/${API_DOCS_PATH}/`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });

  it('CSP rute docs tanpa upgrade-insecure-requests (bisa dibuka lewat http://<ip-lan>)', async () => {
    const res = await http.get(`/${API_DOCS_PATH}/`).set('Accept', 'text/html');
    const csp = String(res.headers['content-security-policy'] ?? '');
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('dokumen yang disajikan = contracts/openapi.yaml (semua path, server /api/v1, bearerAuth)', async () => {
    const init = await http.get(`/${API_DOCS_PATH}/swagger-ui-init.js`);
    expect(init.status).toBe(200);
    const contract = parse(readFileSync(path.resolve(__dirname, '../../contracts/openapi.yaml'), 'utf8')) as {
      paths: Record<string, unknown>;
    };
    const missing = Object.keys(contract.paths).filter((p) => !init.text.includes(`"${p}"`));
    expect(missing).toEqual([]);
    expect(init.text).toContain('"url": "/api/v1"');
    expect(init.text).toContain('"bearerAuth"');
  });

  it('tidak dipasang di NODE_ENV=production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(setupApiDocs(app)).toBe(false);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
