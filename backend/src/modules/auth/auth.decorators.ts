import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthedRequest, AuthPrincipal } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';

/** Tandai route sebagai publik (tanpa access token). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Ambil principal dari request; `undefined` bila route publik tanpa token. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return req.user as AuthPrincipal;
  },
);
