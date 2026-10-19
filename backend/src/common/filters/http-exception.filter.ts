import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorDetail, ErrorEnvelope } from '../envelope';
import { ErrorCodes } from '../errors/error-codes';

type HttpExceptionResponse = {
  code?: string;
  message?: string;
  details?: ErrorDetail[];
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCodes.INTERNAL_ERROR;
    let message = 'Terjadi kesalahan internal';
    let details: ErrorDetail[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res: unknown = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        const body = res as HttpExceptionResponse;
        code = body.code || code;
        message = body.message || message;
        details = body.details;
      } else {
        message = (res as string) || message;
      }
    }

    const envelope: ErrorEnvelope = {
      error: {
        code,
        message,
        details,
        requestId: request.headers['x-request-id'] as string | undefined,
      },
    };

    response.status(status).json(envelope);
  }
}
