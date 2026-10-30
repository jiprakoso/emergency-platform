import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type request from 'supertest';
import { parse } from 'yaml';

/**
 * Validasi respons uji terhadap `contracts/openapi.yaml` (handoff §8: "Kontrak
 * diperiksa pada setiap respons uji terhadap skema OpenAPI").
 *
 * Kontrak tidak memakai `additionalProperties`, jadi helper ini menormalkan skema:
 * `allOf` digabung, lalu setiap objek ber-`properties` menolak field di luar kontrak
 * (perangkap §11 no. 19: field ekstra/hilang, enum tak terdaftar).
 */

type Schema = Record<string, unknown>;

const openapi = parse(readFileSync(path.resolve(__dirname, '../../contracts/openapi.yaml'), 'utf8')) as {
  paths: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> }>>;
};

function resolveRef(ref: string): Schema {
  let node: unknown = openapi;
  for (const part of ref.replace(/^#\//, '').split('/')) {
    node = (node as Record<string, unknown>)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (node === undefined) throw new Error(`$ref tidak ditemukan: ${ref}`);
  }
  return node as Schema;
}

function mergeObjects(parts: Schema[]): Schema {
  const out: Schema = { type: 'object', properties: {} as Record<string, Schema>, required: [] as string[] };
  for (const p of parts) {
    const props = (p.properties ?? {}) as Record<string, Schema>;
    for (const [k, v] of Object.entries(props)) {
      // Properti tanpa batasan tipe (mis. `Envelope.data`) tidak menimpa definisi yang lebih spesifik.
      const existing = (out.properties as Record<string, Schema>)[k];
      if (existing && Object.keys(v).every((key) => key === 'description')) continue;
      (out.properties as Record<string, Schema>)[k] = v;
    }
    (out.required as string[]).push(...((p.required as string[] | undefined) ?? []));
    if (p.description && !out.description) out.description = p.description;
  }
  out.required = [...new Set(out.required as string[])];
  return out;
}

/** Inline `$ref`, gabung `allOf`, tutup objek ber-`properties` (`additionalProperties: false`). */
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (!node || typeof node !== 'object') return node;
  let schema = node as Schema;
  if (typeof schema.$ref === 'string') return normalize(resolveRef(schema.$ref));
  if (Array.isArray(schema.allOf)) {
    const parts = (schema.allOf as unknown[]).map((p) => normalize(p) as Schema);
    const { allOf: _ignored, ...rest } = schema;
    void _ignored;
    schema = mergeObjects([...parts, rest]);
  }
  const out: Schema = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'properties') {
      out.properties = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, normalize(pv)]));
    } else if (k === 'example' || k === 'examples') {
      continue;
    } else {
      out[k] = normalize(v);
    }
  }
  const props = out.properties as Record<string, unknown> | undefined;
  if (props && Object.keys(props).length > 0 && out.additionalProperties === undefined) {
    out.additionalProperties = false;
  }
  return out;
}

const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
addFormats(ajv);
for (const f of ['double', 'float', 'int32', 'int64']) ajv.addFormat(f, true);

const cache = new Map<string, ReturnType<typeof ajv.compile>>();

/**
 * Pastikan `res` (status + body) cocok dengan respons kontrak untuk `METHOD /path`
 * (path templat kontrak, mis. `/incidents/{id}`).
 */
export function expectContract(res: request.Response, method: string, contractPath: string): void {
  const key = `${method.toLowerCase()} ${contractPath} ${res.status}`;
  let validate = cache.get(key);
  if (!validate) {
    const op = openapi.paths[contractPath]?.[method.toLowerCase()];
    if (!op) throw new Error(`operasi tidak ada di kontrak: ${method} ${contractPath}`);
    const schema = op.responses?.[String(res.status)]?.content?.['application/json']?.schema;
    if (!schema) throw new Error(`kontrak tidak mendefinisikan respons ${res.status} untuk ${method} ${contractPath}`);
    validate = ajv.compile(normalize(schema) as Schema);
    cache.set(key, validate);
  }
  if (!validate(res.body)) {
    const errors = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message} ${JSON.stringify(e.params)}`);
    throw new Error(`respons ${method} ${contractPath} (${res.status}) tidak sesuai kontrak:\n${errors.join('\n')}`);
  }
}
