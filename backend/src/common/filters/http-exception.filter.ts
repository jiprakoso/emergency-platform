import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorEnvelope } from '../envelope';
import { ErrorCodes } from '../errors/error-codes';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = ErrorCodes.INTERNAL_ERROR;
    let message = 'Terjadi kesalahan internal';
    let details: any[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse() as any;
      if (typeof res === 'object') {
        code = res.code || code;
        message = res.message || message;
        details = res.details;
      } else {
        message = res || message;
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
