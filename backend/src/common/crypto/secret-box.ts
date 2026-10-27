import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Penyimpanan rahasia singkat terenkripsi (AES-256-GCM) — handoff §9.5.
 *
 * Bentuk nilai tersimpan: `enc:v1.<iv>.<tag>.<cipher>` (base64url).
 * Nilai tanpa awalan `enc:v1.` dianggap plaintext (data pra-enkripsi pada
 * lingkungan sampel) sehingga tidak memerlukan migrasi data.
 *
 * Kunci diterima sebagai 64 heksadesimal, base64 32 byte, atau frasa bebas
 * (di-hash SHA-256) agar mudah dipakai di lingkungan dev.
 */
const PREFIX = 'enc:v1';
const ALGORITHM = 'aes-256-gcm';

export function keyFrom(raw: string | null | undefined): Buffer {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    throw new Error('TOTP_ENCRYPTION_KEY belum di-set.');
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length === 32) return decoded;
  return createHash('sha256').update(trimmed).digest();
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(stored: string, key: Buffer): string {
  if (!stored.startsWith(`${PREFIX}.`)) return stored;
  const [prefix, ivRaw, tagRaw, cipherRaw] = stored.split('.');
  if (prefix !== PREFIX || !ivRaw || !tagRaw || !cipherRaw) {
    throw new Error('Format nilai terenkripsi tidak valid.');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
