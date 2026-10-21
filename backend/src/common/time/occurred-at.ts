import { AppError } from '../errors/app-error';

export const OCCURRED_AT_MAX_FUTURE_MS = 5 * 60 * 1000;
export const OCCURRED_AT_MAX_PAST_MS = 24 * 60 * 60 * 1000;

/**
 * Aturan `occurredAt` (REST §1.5):
 * - tidak lebih dari 5 menit di masa depan (selalu berlaku)
 * - tidak lebih dari 24 jam ke belakang, kecuali dispatcher/supervisor (`canBackdate`)
 * - bila tidak dikirim, `occurredAt = recordedAt`
 */
export function resolveOccurredAt(
  now: Date,
  occurredAt: Date | undefined,
  canBackdate: boolean,
): Date {
  if (!occurredAt) return now;
  const diff = occurredAt.getTime() - now.getTime();
  if (diff > OCCURRED_AT_MAX_FUTURE_MS) {
    throw new AppError('OCCURRED_AT_OUT_OF_RANGE', 'Waktu kejadian terlalu jauh di masa depan.');
  }
  if (!canBackdate && -diff > OCCURRED_AT_MAX_PAST_MS) {
    throw new AppError(
      'OCCURRED_AT_OUT_OF_RANGE',
      'Waktu kejadian lebih dari 24 jam ke belakang tidak diizinkan.',
    );
  }
  return occurredAt;
}
