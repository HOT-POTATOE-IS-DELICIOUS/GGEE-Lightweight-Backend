import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { BusinessException } from '../common/error/business.exception';
import { SessionRepository } from '../modules/member/repositories/session.repository';
import { TokenService } from '../modules/member/jwt/token.service';
import { AuthUser } from './auth-user';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Role } from './role.enum';

const PRINCIPAL: AuthUser = { userId: '42', role: Role.USER, sessionId: '99' };

function makeResponse() {
  const end = jest.fn();
  const send = jest.fn();
  const json = jest.fn();
  const status = jest.fn(() => ({ end, send, json }));
  const res = { status } as unknown as Response;
  return { res, status, end, send, json };
}

function makeContext(req: Partial<Request>, res: Response): ExecutionContext {
  return {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let tokens: jest.Mocked<Pick<TokenService, 'resolveAccess'>> & {
    authorizationHeaderName: string;
  };
  let sessions: jest.Mocked<Pick<SessionRepository, 'findBySessionId'>>;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    tokens = { authorizationHeaderName: 'Authorization', resolveAccess: jest.fn() };
    sessions = { findBySessionId: jest.fn() };
    guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      tokens as unknown as TokenService,
      sessions as unknown as SessionRepository,
    );
  });

  it('allows a @Public() route without touching the token service', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { res, status } = makeResponse();
    const ctx = makeContext({ headers: {} }, res);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(tokens.resolveAccess).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header with a 401 empty body', async () => {
    const { res, status, end, send, json } = makeResponse();
    const ctx = makeContext({ headers: {} }, res);

    await expect(guard.canActivate(ctx)).resolves.toBe(false);
    expect(status).toHaveBeenCalledWith(401);
    expect(end).toHaveBeenCalledWith();
    expect(send).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('rejects a blank Authorization header with a 401 empty body', async () => {
    const { res, status, end } = makeResponse();
    const ctx = makeContext({ headers: { authorization: '   ' } }, res);

    await expect(guard.canActivate(ctx)).resolves.toBe(false);
    expect(status).toHaveBeenCalledWith(401);
    expect(end).toHaveBeenCalledWith();
    expect(tokens.resolveAccess).not.toHaveBeenCalled();
  });

  it('allows a valid token with an active session and attaches the principal', async () => {
    tokens.resolveAccess.mockReturnValue(PRINCIPAL);
    sessions.findBySessionId.mockResolvedValue({
      expiresAt: new Date(Date.now() + 100_000),
    } as any);
    const req: any = { headers: { authorization: 'Bearer good-token' } };
    const { res, status } = makeResponse();

    await expect(guard.canActivate(makeContext(req, res))).resolves.toBe(true);
    expect(req.user).toEqual(PRINCIPAL);
    expect(status).not.toHaveBeenCalled();
  });

  it('rejects when the session is not found with a 401 empty body', async () => {
    tokens.resolveAccess.mockReturnValue(PRINCIPAL);
    sessions.findBySessionId.mockResolvedValue(null);
    const { res, status, end, send } = makeResponse();
    const ctx = makeContext({ headers: { authorization: 'Bearer good' } }, res);

    await expect(guard.canActivate(ctx)).resolves.toBe(false);
    expect(status).toHaveBeenCalledWith(401);
    expect(end).toHaveBeenCalledWith();
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects an expired session with a 401 empty body', async () => {
    tokens.resolveAccess.mockReturnValue(PRINCIPAL);
    sessions.findBySessionId.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1000),
    } as any);
    const { res, status, end, send } = makeResponse();
    const ctx = makeContext({ headers: { authorization: 'Bearer good' } }, res);

    await expect(guard.canActivate(ctx)).resolves.toBe(false);
    expect(status).toHaveBeenCalledWith(401);
    expect(end).toHaveBeenCalledWith();
    expect(send).not.toHaveBeenCalled();
  });

  it('maps an EXPIRED_TOKEN from the token service to its 401 status, empty body', async () => {
    tokens.resolveAccess.mockImplementation(() => {
      throw new BusinessException('EXPIRED_TOKEN');
    });
    const { res, status, end, send } = makeResponse();
    const ctx = makeContext({ headers: { authorization: 'Bearer expired' } }, res);

    await expect(guard.canActivate(ctx)).resolves.toBe(false);
    expect(status).toHaveBeenCalledWith(401);
    expect(end).toHaveBeenCalledWith();
    expect(send).not.toHaveBeenCalled();
  });
});
