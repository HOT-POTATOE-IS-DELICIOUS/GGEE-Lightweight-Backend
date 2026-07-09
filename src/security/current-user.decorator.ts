import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './auth-user';

/**
 * Injects the authenticated `AuthUser` (set by JwtAuthGuard) into a handler param.
 * Port of Spring's `@AuthenticationPrincipal CustomAuthPrincipal`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    return request.user as AuthUser;
  },
);
