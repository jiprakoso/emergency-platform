import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuditContext } from './audit.service';

/** Ambil IP, user-agent, dan `X-Request-Id` untuk baris `audit_logs`. */
export const AuditCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuditContext => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const requestId = req.headers['x-request-id'];
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
    requestId: typeof requestId === 'string' ? requestId : null,
  };
});
