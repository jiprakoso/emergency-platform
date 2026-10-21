import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorDetail, ErrorEnvelope } from '../envelope';
import { ErrorCodes, ErrorHttpStatus } from '../errors/error-codes';

type HttpExceptionResponse = {
  code?: string;
  message?: string | string[];
  details?: ErrorDetail[];
  currentVersion?: number;
  lockedBy?: string;
  lockedAt?: string;
  [key: string]: unknown;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.headers['x-request-id'] as string | undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCodes.INTERNAL_ERROR;
    let message = 'Terjadi kesalahan internal.';
    let details: ErrorDetail[] | undefined;
    let extra: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res: unknown = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        const body = res as HttpExceptionResponse;
        if (Array.isArray(body.message)) {
          // Nest ValidationPipe: daftar pesan
          code = body.code || ErrorCodes.VALIDATION_FAILED;
          message = 'Isi permintaan tidak valid.';
          details = body.message.map((m) => ({ issue: m }));
        } else if (body.code) {
          // AppError / HttpException yang sudah memuat code stabil
          code = body.code;
          message = (body.message as string) || defaultMessage(status);
          details = body.details;
        } else {
          // HttpException bawaan Nest: pakai pesan Indonesia yang stabil,
          // jangan bocorkan pesan internal Inggris.
          code = deriveCodeFromStatus(status);
          message = defaultMessage(status);
        }
        const { code: _c, message: _m, details: _d, error: _e, statusCode: _s, ...rest } = body;
        void _c;
        void _m;
        void _d;
        void _e;
        void _s;
        if (Object.keys(rest).length > 0) {
          extra = rest;
        }
      } else {
        message = (res as string) || defaultMessage(status);
        code = deriveCodeFromStatus(status);
      }
    } else {
      // Kesalahan tak terduga tidak boleh membocorkan detail
      request.log?.error?.({ err: exception }, 'unhandled exception');
    }

    const envelope: ErrorEnvelope = {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
        ...(extra ? extra : {}),
        requestId,
      } as ErrorEnvelope['error'],
    };

    if (extra && typeof extra.retryAfterSeconds === 'number') {
      response.setHeader('Retry-After', String(extra.retryAfterSeconds));
    }
    response.setHeader('X-Request-Id', requestId ?? '');
    response.status(status).json(envelope);
  }
}

function deriveCodeFromStatus(status: number): string {
  for (const [code, s] of Object.entries(ErrorHttpStatus)) {
    if (s === status && code !== ErrorCodes.INTERNAL_ERROR) return code;
  }
  return ErrorCodes.INTERNAL_ERROR;
}

function defaultMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Isi permintaan tidak valid.';
    case 401:
      return 'Tidak terautentikasi.';
    case 403:
      return 'Anda tidak memiliki hak untuk tindakan ini.';
    case 404:
      return 'Data tidak ditemukan.';
    case 409:
      return 'Konflik dengan keadaan saat ini.';
    case 429:
      return 'Terlalu banyak permintaan.';
    default:
      return 'Terjadi kesalahan internal.';
  }
}
