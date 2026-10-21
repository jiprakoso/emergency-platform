import { createHash } from 'node:crypto';

/** SHA-256 hex. Dipakai untuk hash token/OTP/isi idempotensi (bukan untuk sandi). */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Hash kanonik isi permintaan untuk perbandingan idempotensi. */
export function hashPayload(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}

/** JSON.stringify dengan kunci terurut agar hash stabil. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
