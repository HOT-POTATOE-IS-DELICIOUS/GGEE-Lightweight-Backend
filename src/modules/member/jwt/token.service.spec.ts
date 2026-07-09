import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { AuthUser } from '../../../security/auth-user';
import { Role } from '../../../security/role.enum';
import { TokenService, TokenType } from './token.service';

const SECRET_B64 = Buffer.from('a'.repeat(32)).toString('base64');
const KEY = Buffer.from(SECRET_B64, 'base64');
const ACCESS_MS = 3_600_000;
const REFRESH_MS = 1_209_600_000;

const CONFIG_MAP: Record<string, unknown> = {
  'jwt.secretKeyBase64': SECRET_B64,
  'jwt.header': 'Authorization',
  'jwt.prefix': 'Bearer',
  'jwt.accessTokenActiveTimeMs': ACCESS_MS,
  'jwt.refreshTokenActiveTimeMs': REFRESH_MS,
};

const stubConfig = {
  getOrThrow: (key: string) => {
    if (!(key in CONFIG_MAP)) throw new Error(`unexpected config key: ${key}`);
    return CONFIG_MAP[key];
  },
} as unknown as ConfigService;

const principal: AuthUser = { userId: '42', role: Role.USER, sessionId: '99' };

/** Sign a raw JWT directly (used to forge expired / wrong-role / wrong-key tokens). */
function signRaw(overrides: Record<string, unknown>, key: Buffer = KEY): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    sub: '42',
    role: Role.USER,
    tokenType: TokenType.ACCESS_TOKEN,
    sessionId: '99',
    iat: nowSec,
    exp: nowSec + 3600,
    ...overrides,
  };
  return jwt.sign(payload, key, { algorithm: 'HS256' });
}

describe('TokenService token uniqueness', () => {
  // Regression: iat/exp are second-granularity, so without a `jti` nonce two tokens minted for
  // the same principal inside one second were byte-identical. That made refresh rotation a no-op
  // and defeated refresh-token reuse detection.
  it('mints a distinct token on every call, even within the same millisecond', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const service = new TokenService(stubConfig);

    const first = service.generateRefreshToken(principal);
    const second = service.generateRefreshToken(principal);

    expect(first).not.toBe(second);
    expect(service.resolveRefresh(first).sessionId).toBe('99');
    expect(service.resolveRefresh(second).sessionId).toBe('99');
    jest.restoreAllMocks();
  });

  it('carries a unique jti claim', () => {
    const service = new TokenService(stubConfig);
    const decode = (token: string) => (jwt.decode(token) as { jti: string }).jti;

    expect(decode(service.generateAccessToken(principal))).not.toBe(
      decode(service.generateAccessToken(principal)),
    );
  });
});

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(() => {
    service = new TokenService(stubConfig);
  });

  it('generateAccessToken produces an HS256 JWT with lowercase "jwt" typ header', () => {
    const token = service.generateAccessToken(principal);
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded?.header.typ).toBe('jwt');
    expect(decoded?.header.alg).toBe('HS256');
  });

  it('generateRefreshToken produces an HS256 JWT with lowercase "jwt" typ header', () => {
    const token = service.generateRefreshToken(principal);
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded?.header.typ).toBe('jwt');
    expect(decoded?.header.alg).toBe('HS256');
  });

  it('embeds sub/role/sessionId and ACCESS_TOKEN type with the access active time', () => {
    const token = service.generateAccessToken(principal);
    const claims = jwt.decode(token) as Record<string, any>;
    expect(claims.sub).toBe(principal.userId);
    expect(claims.role).toBe(principal.role);
    expect(claims.sessionId).toBe(principal.sessionId);
    expect(claims.tokenType).toBe('ACCESS_TOKEN');
    expect(claims.exp - claims.iat).toBe(ACCESS_MS / 1000);
  });

  it('embeds REFRESH_TOKEN type with the refresh active time', () => {
    const token = service.generateRefreshToken(principal);
    const claims = jwt.decode(token) as Record<string, any>;
    expect(claims.tokenType).toBe('REFRESH_TOKEN');
    expect(claims.exp - claims.iat).toBe(REFRESH_MS / 1000);
  });

  it('resolveAccess returns the principal from a "Bearer <token>" header', () => {
    const token = service.generateAccessToken(principal);
    expect(service.resolveAccess(`Bearer ${token}`)).toEqual({
      userId: '42',
      role: Role.USER,
      sessionId: '99',
    });
  });

  it('resolveAccess tolerates extra whitespace after the prefix', () => {
    const token = service.generateAccessToken(principal);
    expect(service.resolveAccess(`Bearer     ${token}`)).toEqual({
      userId: '42',
      role: Role.USER,
      sessionId: '99',
    });
  });

  it('resolveAccess rejects a header not starting with the prefix (INVALID_TOKEN)', () => {
    const token = service.generateAccessToken(principal);
    expect(() => service.resolveAccess(token)).toThrow(
      expect.objectContaining({ code: 'INVALID_TOKEN' }),
    );
  });

  it('resolveAccess rejects a refresh token (INVALID_TOKEN_TYPE)', () => {
    const refresh = service.generateRefreshToken(principal);
    expect(() => service.resolveAccess(`Bearer ${refresh}`)).toThrow(
      expect.objectContaining({ code: 'INVALID_TOKEN_TYPE' }),
    );
  });

  it('resolveRefresh rejects an access token (INVALID_TOKEN_TYPE)', () => {
    const access = service.generateAccessToken(principal);
    expect(() => service.resolveRefresh(access)).toThrow(
      expect.objectContaining({ code: 'INVALID_TOKEN_TYPE' }),
    );
  });

  it('resolveAccess maps an expired access token to EXPIRED_TOKEN', () => {
    const past = Math.floor(Date.now() / 1000) - 100;
    const expired = signRaw({ iat: past - 10, exp: past });
    expect(() => service.resolveAccess(`Bearer ${expired}`)).toThrow(
      expect.objectContaining({ code: 'EXPIRED_TOKEN' }),
    );
  });

  it('resolveRefresh maps an expired refresh token to EXPIRED_REFRESH_TOKEN', () => {
    const past = Math.floor(Date.now() / 1000) - 100;
    const expired = signRaw({ tokenType: TokenType.REFRESH_TOKEN, iat: past - 10, exp: past });
    expect(() => service.resolveRefresh(expired)).toThrow(
      expect.objectContaining({ code: 'EXPIRED_REFRESH_TOKEN' }),
    );
  });

  it('resolveAccess rejects a garbage token (INVALID_TOKEN)', () => {
    expect(() => service.resolveAccess('Bearer not.a.jwt')).toThrow(
      expect.objectContaining({ code: 'INVALID_TOKEN' }),
    );
  });

  it('resolveAccess rejects a wrong-signature token (INVALID_TOKEN)', () => {
    const wrong = signRaw({}, Buffer.from('b'.repeat(32)));
    expect(() => service.resolveAccess(`Bearer ${wrong}`)).toThrow(
      expect.objectContaining({ code: 'INVALID_TOKEN' }),
    );
  });

  it('normalizes a ROLE_ADMIN claim to Role.ADMIN', () => {
    const token = signRaw({ role: 'ROLE_ADMIN' });
    expect(service.resolveAccess(`Bearer ${token}`).role).toBe(Role.ADMIN);
  });

  it('rejects an unknown role claim (INVALID_TOKEN)', () => {
    const token = signRaw({ role: 'ROLE_SUPERHERO' });
    expect(() => service.resolveAccess(`Bearer ${token}`)).toThrow(
      expect.objectContaining({ code: 'INVALID_TOKEN' }),
    );
  });
});
