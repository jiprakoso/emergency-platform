import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionService } from './permission.service';
import { PERMISSIONS_KEY } from './permission.decorators';
import { AuthedRequest } from '../auth/auth.types';
import { AppError } from '../../common/errors/app-error';

/** Guard global: cek permission yang diminta lewat `@RequirePermission(...)`. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) {
      throw AppError.unauthenticated();
    }

    const ok = await this.permissions.hasAnyPermission(req.user.userId, required);
    if (!ok) {
      throw AppError.forbidden();
    }
    return true;
  }
}
