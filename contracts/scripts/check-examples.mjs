// Validasi & cek cakupan contoh JSON terhadap kontrak (handoff §6.5).
// Dijalankan: node contracts/scripts/check-examples.mjs
// Menggunakan ajv (draft 2020-12) dengan resolver $ref internal yang sederhana.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import YAML from "yaml";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const openapi = YAML.parse(readFileSync(join(root, "contracts", "openapi.yaml"), "utf8"));
const asyncapi = YAML.parse(readFileSync(join(root, "contracts", "asyncapi.yaml"), "utf8"));
const examplesDir = join(root, "contracts", "examples");

const fail = [];
const warn = (m) => fail.push(m);

function resolver(rootDoc) {
  return (ref) => {
    let node = rootDoc;
    for (const part of ref.replace(/^#\//, "").split("/")) {
      node = node[part];
      if (node === undefined) throw new Error(`ref tidak dapat diselesaikan: ${ref}`);
    }
    return node;
  };
}

const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  allowUnionTypes: true,
  validateFormats: false,
  addUsedSchema: false,
});
addFormats(ajv);

// --- skema respons per operasi (openapi) & payload per message (asyncapi) ---
// Operasi yang skema suksesnya tak-tertiping (Envelope polos / page ber-item object)
// tidak divalidasi strukturnya (dokumen memang mendefinisikannya longgar).
function isGenericSchema(schema) {
  if (!schema || typeof schema !== "object") return false;
  if (schema.$ref === "#/components/schemas/Envelope" || schema.$ref === "#/components/schemas/PageEnvelope") return true;
  return false;
}
const respSchema = new Map(); // opId -> [ { code, schema } ]
const genericOps = new Set();
for (const item of Object.values(openapi.paths)) {
  for (const op of Object.values(item)) {
    if (!op || typeof op !== "object" || !op.operationId) continue;
    const list = [];
    let generic = false;
    for (const [code, r] of Object.entries(op.responses ?? {})) {
      if (code.startsWith("2") && r?.content?.["application/json"]?.schema) {
        const sch = r.content["application/json"].schema;
        list.push({ code, schema: sch });
        if (isGenericSchema(sch)) generic = true;
      }
    }
    if (list.length) respSchema.set(op.operationId, list);
    if (generic) genericOps.add(op.operationId);
  }
}

const msgSchema = new Map(); // event name -> payload schema
for (const m of Object.values(asyncapi.components.messages)) {
  msgSchema.set(m.name, m.payload);
}

const openapiResolve = resolver(openapi);
const asyncResolve = resolver(asyncapi);

function validate(schema, data, resolveFn, label) {
  let validator;
  try {
    validator = ajv.compile(schema);
  } catch (e) {
    warn(`${label}: skema gagal dikompilasi (${e.message})`);
    return false;
  }
  // $ref sudah diselesaikan oleh compile via resolver internal ajv? ajv tidak tahu
  // resolver kustom -> pra-resolve: gabungkan lewat allOf manual.
  const ok = validator(data);
  if (!ok) {
    for (const err of validator.errors ?? []) {
      warn(`${label}: ${err.instancePath || "/"} ${err.message}`);
    }
  }
  return ok;
}

// Ajv tidak menerima fungsi resolver; pra-inline semua $ref dari dokumen sumber.
function inlineRefs(node, resolveFn, rootRef) {
  if (Array.isArray(node)) return node.map((n) => inlineRefs(n, resolveFn, rootRef));
  if (node && typeof node === "object") {
    if (typeof node.$ref === "string") {
      const target = resolveFn(node.$ref);
      return inlineRefs(target, resolveFn, rootRef);
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = inlineRefs(v, resolveFn, rootRef);
    return out;
  }
  return node;
}

function validateInlined(schema, resolveFn, data, label) {
  const inlined = inlineRefs(schema, resolveFn);
  let validator;
  try {
    validator = ajv.compile(inlined);
  } catch (e) {
    warn(`${label}: skema gagal dikompilasi (${e.message})`);
    return false;
  }
  const ok = validator(data);
  if (!ok) {
    for (const err of validator.errors ?? []) {
      warn(`${label}: ${err.instancePath || "/"} ${err.message}`);
    }
  }
  return ok;
}

// --- 1. REST: setiap contoh harus match salah satu skema respons sukses ---
// Pages ber-item object (items: {type: object}) juga tidak divalidasi isinya.
function pageHasGenericItems(opId) {
  for (const { schema } of respSchema.get(opId) ?? []) {
    const t = JSON.stringify(schema);
    if (schema.$ref === "#/components/schemas/PageEnvelope") return true;
    if (t.includes('"items":{"type":"object"}')) return true;
  }
  return false;
}
const restDir = join(examplesDir, "rest");
let restFiles = [];
if (existsSync(restDir)) {
  restFiles = readdirSync(restDir).filter((f) => f.endsWith(".json") && !f.startsWith("errors"));
}
const seenOps = new Set();
for (const f of restFiles) {
  const base = f.replace(/\.json$/, "");
  const opId = base.split(".")[0];
  const list = respSchema.get(opId);
  if (!list) {
    warn(`rest/${f}: tidak ada skema respons sukses untuk operationId '${opId}'`);
    continue;
  }
  seenOps.add(opId);
  const data = JSON.parse(readFileSync(join(restDir, f), "utf8"));
  const generic = genericOps.has(opId) || pageHasGenericItems(opId);
  const ok =
    generic ||
    list.some(({ schema }, i) => validateInlined(schema, openapiResolve, data, `rest/${f}#alt${i}`));
  if (!ok) fail.push(`rest/${f}: TIDAK cocok skema respons manapun`);
}for (const opId of respSchema.keys()) {
  if (!seenOps.has(opId)) warn(`cakupan: operasi ber-respons sukses tanpa contoh: ${opId}`);
}

// --- 2. REST errors: setiap berkas harus match ErrorEnvelope ---
const errDir = join(examplesDir, "rest", "errors");
const errCodes = new Set();
if (existsSync(errDir)) {
  for (const f of readdirSync(errDir).filter((x) => x.endsWith(".json"))) {
    errCodes.add(f.replace(/\.json$/, ""));
    const data = JSON.parse(readFileSync(join(errDir, f), "utf8"));
    const schema = openapi.components.schemas.ErrorEnvelope;
    if (!validateInlined(schema, openapiResolve, data, `rest/errors/${f}`)) {
      fail.push(`rest/errors/${f}: tidak match ErrorEnvelope`);
    }
  }
}
// daftar ErrorCode dari kontrak
const errorEnum =
  openapi.components.schemas.ErrorCode?.enum ??
  openapi.components.schemas.ErrorBody?.properties?.code?.enum ??
  [];
for (const code of errorEnum) {
  if (!errCodes.has(code)) warn(`cakupan: ErrorCode '${code}' tanpa contoh`);
}
for (const c of errCodes) {
  if (errorEnum.length && !errorEnum.includes(c)) warn(`errors/${c}: bukan ErrorCode resmi`);
}

// --- 3. WS: setiap contoh match payload message; tiap message s2c punya contoh per audiens ---
const wsDir = join(examplesDir, "ws");
const wsSeen = new Map(); // event -> Set(audience)
if (existsSync(wsDir)) {
  for (const f of readdirSync(wsDir).filter((x) => x.endsWith(".json"))) {
    const parts = f.replace(/\.json$/, "").split(".");
    // nama event bisa 1-2 token; pilih kandidat terpanjang yang cocok
    let eventName = null;
    for (let n = Math.min(2, parts.length); n >= 1; n--) {
      const cand = parts.slice(0, n).join(".");
      if (msgSchema.has(cand)) {
        eventName = cand;
        break;
      }
    }
    if (!eventName) {
      warn(`ws/${f}: tidak ada message yang cocok`);
      continue;
    }
    const schema = msgSchema.get(eventName);
    const rest = parts.slice(eventName.split(".").length);
    const aud = rest[0] ?? "";
    if (!wsSeen.has(eventName)) wsSeen.set(eventName, new Set());
    wsSeen.get(eventName).add(aud);
    const data = JSON.parse(readFileSync(join(wsDir, f), "utf8"));
    if (!validateInlined(schema, asyncResolve, data, `ws/${f}`)) {
      fail.push(`ws/${f}: tidak match payload message '${eventName}'`);
    }
  }
}
for (const m of Object.values(asyncapi.components.messages)) {
  if (m["x-direction"] !== "s2c") continue;
  if (!wsSeen.has(m.name)) warn(`cakupan: event s2c '${m.name}' tanpa contoh`);
}

// --- ringkasan ---
// buang warning duplikat dari alternatif skema
const uniq = [...new Set(fail)];
const coverage = fail.filter((m) => m.startsWith("cakupan:"));
const errors = uniq.filter((m) => !m.startsWith("cakupan:"));
if (coverage.length) {
  console.log("CATATAN CAKUPAN:");
  for (const c of coverage) console.log("  - " + c);
}
if (errors.length) {
  console.error("CONTOH TIDAK VALID:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(
  `EXAMPLES OK: ${restFiles.length} rest, ${errCodes.size} error, ${[...wsSeen.values()].reduce((a, s) => a + s.size, 0)} ws`
);
