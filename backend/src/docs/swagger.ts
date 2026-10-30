import { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';

/** Rute Swagger UI (di luar prefix `api/v1`, bukan bagian kontrak). */
export const API_DOCS_PATH = 'api/docs';

/**
 * Lokasi `contracts/openapi.yaml`. Dari `src/docs` maupun `dist/docs`, tiga tingkat
 * ke atas adalah akar repo; dapat ditimpa `API_DOCS_OPENAPI_PATH`.
 */
function openapiPath(): string {
  return process.env.API_DOCS_OPENAPI_PATH ?? path.resolve(__dirname, '../../../contracts/openapi.yaml');
}

/**
 * Swagger UI contract-first (handoff §13.2, titik tinjau C1 "melalui Swagger"):
 * menyajikan `contracts/openapi.yaml` apa adanya — bukan dokumen hasil dekorator —
 * sehingga tampilan tidak bisa menyimpang dari kontrak yang disetujui. "Try it out"
 * memanggil server ini (`servers: /api/v1`). Mati di `NODE_ENV=production`.
 */
export function setupApiDocs(app: INestApplication): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const document = parse(readFileSync(openapiPath(), 'utf8')) as swaggerUi.JsonObject;
  app.use(
    `/${API_DOCS_PATH}`,
    // CSP helmet memuat `upgrade-insecure-requests`: bila dibuka lewat http://<ip-lan>,
    // aset UI dipaksa ke https dan halaman kosong. Dibuang khusus untuk rute docs.
    (_req: Request, res: Response, next: NextFunction) => {
      const csp = res.getHeader('Content-Security-Policy');
      if (typeof csp === 'string') {
        res.setHeader('Content-Security-Policy', csp.replace(/;?upgrade-insecure-requests/, ''));
      }
      next();
    },
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: 'Emergency Platform API (sampel)',
      swaggerOptions: { persistAuthorization: false, displayRequestDuration: true, tryItOutEnabled: true },
    }),
  );
  return true;
}
