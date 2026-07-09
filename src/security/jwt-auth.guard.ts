import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { BusinessException } from '../common/error/business.exception';
import { SessionRepository } from '../modules/member/repositories/session.repository';
import { TokenService } from '../modules/member/jwt/token.service';
import { AuthUser } from './auth-user';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Port of `AuthFilter` + Spring Security `anyExchange().authenticated()`.
 *
 * Registered globally (APP_GUARD). Public routes (@Public) bypass. On any auth failure the
 * guard writes an EMPTY body with the mapped status and stops the pipeline — matching the
 * original AuthFilter, which writes the status via `setComplete()` with no body (it does NOT
 * go through the plain-text error advice).
 *
 * Session validity (existence + not-expired) is re-checked on EVERY authenticated request,
 * so a logout / other-device login immediately invalidates in-flight access tokens.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const res = context.switchToHttp().getResponse<Response>();

    try {
      const headerName = this.tokens.authorizationHeaderName.toLowerCase();
      const raw = req.headers[headerName];
      const headerValue = Array.isArray(raw) ? raw[0] : raw;
      if (!headerValue || headerValue.trim() === '') {
        throw new BusinessException('INVALID_TOKEN');
      }

      const principal = this.tokens.resolveAccess(headerValue);

      const session = await this.sessions.findBySessionId(principal.sessionId);
      if (!session) {
        throw new BusinessException('INVALID_SESSION');
      }
      if (session.expiresAt.getTime() < Date.now()) {
        throw new BusinessException('SESSION_EXPIRED');
      }

      req.user = principal;
      return true;
    } catch (err) {
      const status = err instanceof BusinessException ? err.status : 401;
      res.status(status).end(); // empty body, mirrors AuthFilter
      return false;
    }
  }
}
