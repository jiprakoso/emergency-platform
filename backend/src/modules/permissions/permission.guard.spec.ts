import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { PermissionService } from './permission.service';
import { AppError } from '../../common/errors/app-error';
import { catchError } from '../../testing/fakes';

type GuardDeps = {
  required: string[] | undefined;
  hasPermission: boolean;
  request: Record<string, unknown>;
};

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => (): void => undefined,
    getClass: () => class Handler {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

type GuardBundle = { guard: PermissionGuard; hasAny: jest.Mock; ctx: ExecutionContext };

function buildGuard(deps: GuardDeps): GuardBundle {
  const reflector = {
    getAllAndOverride: jest.fn(() => deps.required),
  } as unknown as Reflector;
  const hasAny = jest.fn(async () => deps.hasPermission);
  const permissions = { hasAnyPermission: hasAny } as unknown as PermissionService;
  return {
    guard: new PermissionGuard(reflector, permissions),
    hasAny,
    ctx: contextFor(deps.request),
  };
}

describe('PermissionGuard', () => {
  it('melewati endpoint tanpa @RequirePermission', async () => {
    const { guard, hasAny, ctx } = buildGuard({
      required: undefined,
      hasPermission: false,
      request: {},
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(hasAny).not.toHaveBeenCalled();
  });

  it('menolak dengan 401 bila permintaan tidak terautentikasi', async () => {
    const { guard, hasAny, ctx } = buildGuard({
      required: ['dispatch.create'],
      hasPermission: true,
      request: {},
    });
    const err = await catchError(guard.canActivate(ctx));
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('UNAUTHENTICATED');
    expect((err as AppError).getStatus()).toBe(401);
    expect(hasAny).not.toHaveBeenCalled();
  });

  it('mengizinkan bila pengguna punya salah satu izin yang diminta', async () => {
    const { guard, hasAny, ctx } = buildGuard({
      required: ['incident.verify', 'incident.close'],
      hasPermission: true,
      request: { user: { userId: 'u1', roles: ['DISPATCHER'] } },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(hasAny).toHaveBeenCalledWith('u1', ['incident.verify', 'incident.close']);
  });

  it('menolak dengan 403 bila tidak punya izin', async () => {
    const { guard, hasAny, ctx } = buildGuard({
      required: ['settings.manage'],
      hasPermission: false,
      request: { user: { userId: 'u2', roles: ['RESPONDER'] } },
    });
    const err = await catchError(guard.canActivate(ctx));
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('FORBIDDEN');
    expect((err as AppError).getStatus()).toBe(403);
    expect(hasAny).toHaveBeenCalledWith('u2', ['settings.manage']);
  });
});
