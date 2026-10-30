import { Param, ParseUUIDPipe } from '@nestjs/common';
import { AppError } from '../errors/app-error';

/**
 * `@Param` UUID: id yang bukan UUID dijawab 404 (sama seperti id tak dikenal) —
 * tidak sampai ke Postgres (galat 500) dan tidak membedakan "format salah" dari
 * "tidak ada" (handoff §11 no. 14).
 */
export const IdParam = (name = 'id') =>
  Param(name, new ParseUUIDPipe({ exceptionFactory: () => AppError.notFound('Data tidak ditemukan.') }));
