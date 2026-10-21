import { AppError } from '../errors/app-error';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export type CursorPayload = Record<string, string | number | null>;

/**
 * Cursor opaque = base64url dari JSON payload. Klien tidak boleh mengandalkan isinya.
 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('bukan objek');
    }
    return parsed as CursorPayload;
  } catch {
    throw AppError.validation('Cursor tidak valid.');
  }
}

export function normalizeLimit(limit?: number): number {
  if (limit === undefined || limit === null) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw AppError.validation('Parameter limit tidak valid.');
  }
  return Math.min(limit, MAX_LIMIT);
}
