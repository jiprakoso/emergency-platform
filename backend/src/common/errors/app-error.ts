import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorHttpStatus } from './error-codes';

export type AppErrorDetail = {
  field?: string;
  message?: string;
  issue?: string;
  code?: string;
};

/**
 * Galat aplikasi dengan `code` stabil. Pesan dalam Bahasa Indonesia.
 * Gunakan helper statik di bawah agar konsisten dengan katalog REST §7.
 */
export class AppError extends HttpException {
  constructor(
    public readonly code: ErrorCode | string,
    message: string,
    details?: AppErrorDetail[],
    status?: number,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(
      { code, message, details, ...(extra ?? {}) },
      status ?? ErrorHttpStatus[code] ?? HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  static validation(message: string, details?: AppErrorDetail[]) {
    return new AppError('VALIDATION_FAILED', message, details);
  }
  static unauthenticated(message = 'Sesi tidak valid atau token tidak ada.') {
    return new AppError('UNAUTHENTICATED', message);
  }
  static forbidden(message = 'Anda tidak memiliki hak untuk tindakan ini.') {
    return new AppError('FORBIDDEN', message);
  }
  static notFound(message = 'Data tidak ditemukan.') {
    return new AppError('NOT_FOUND', message);
  }
  static conflict(
    message: string,
    code: ErrorCode = 'INVALID_STATUS_TRANSITION',
    details?: AppErrorDetail[],
  ) {
    return new AppError(code, message, details);
  }
  static internal(message = 'Terjadi kesalahan internal.') {
    return new AppError('INTERNAL_ERROR', message);
  }
}
