import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { BusinessException } from '../../../common/error/business.exception';
import { AuthUser } from '../../../security/auth-user';
import { Role } from '../../../security/role.enum';

export enum TokenType {
  ACCESS_TOKEN = 'ACCESS_TOKEN',
  REFRESH_TOKEN = 'REFRESH_TOKEN',
}

interface Claims {
  sub: string;
  role: string;
  tokenType: string;
  sessionId: string;
  jti: string;
  iat: number;
  exp: number;
}

/**
 * Port of `TokenGeneratorAdapter` + `TokenResolverAdapter` + `RefreshTokenResolverAdapter`.
 *
 *  - HS256, secret is Base64-decoded into the raw HMAC key.
 *  - Header type literal is lowercase "jwt" (matches the original).
 *  - Claims: sub=userId, role, tokenType (ACCESS_TOKEN|REFRESH_TOKEN), sessionId; expiry in ms.
 */
@Injectable()
export class TokenService {
  private readonly key: Buffer;
  private readonly header: string;
  private readonly prefix: string;
  private readonly accessActiveMs: number;
  private readonly refreshActiveMs: number;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('jwt.secretKeyBase64'), 'base64');
    this.header = config.getOrThrow<string>('jwt.header');
    this.prefix = config.getOrThrow<string>('jwt.prefix');
    this.accessActiveMs = config.getOrThrow<number>('jwt.accessTokenActiveTimeMs');
    this.refreshActiveMs = config.getOrThrow<number>('jwt.refreshTokenActiveTimeMs');
  }

  get authorizationHeaderName(): string {
    return this.header;
  }

  generateAccessToken(principal: AuthUser): string {
    return this.generate(principal, TokenType.ACCESS_TOKEN, this.accessActiveMs);
  }

  generateRefreshToken(principal: AuthUser): string {
    return this.generate(principal, TokenType.REFRESH_TOKEN, this.refreshActiveMs);
  }

  private generate(principal: AuthUser, tokenType: TokenType, activeMs: number): string {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      sub: principal.userId,
      role: principal.role,
      tokenType,
      sessionId: principal.sessionId,
      // `iat`/`exp` are second-granularity, so without a nonce two tokens minted for the same
      // principal within one second would be byte-identical. That would make refresh rotation a
      // no-op (the CAS rewrites the same hash) and silently defeat reuse detection.
      jti: randomUUID(),
      iat: nowSec,
      exp: nowSec + Math.floor(activeMs / 1000),
    };
    return jwt.sign(payload, this.key, { algorithm: 'HS256', header: { alg: 'HS256', typ: 'jwt' } });
  }

  /** Resolve an access token from the raw `Authorization` header value (with Bearer prefix). */
  resolveAccess(headerValue: string): AuthUser {
    if (!headerValue.startsWith(this.prefix)) {
      throw new BusinessException('INVALID_TOKEN');
    }
    const token = headerValue.substring(this.prefix.length).trim();
    return this.parse(token, TokenType.ACCESS_TOKEN);
  }

  /** Resolve a refresh token from a raw token string (no prefix). */
  resolveRefresh(rawToken: string): AuthUser {
    return this.parse(rawToken, TokenType.REFRESH_TOKEN);
  }

  private parse(token: string, expected: TokenType): AuthUser {
    let claims: Claims;
    try {
      claims = jwt.verify(token, this.key, { algorithms: ['HS256'] }) as Claims;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new BusinessException(
          expected === TokenType.REFRESH_TOKEN ? 'EXPIRED_REFRESH_TOKEN' : 'EXPIRED_TOKEN',
        );
      }
      throw new BusinessException('INVALID_TOKEN');
    }

    // `claims.tokenType` is a raw string off an untrusted token, so widen the enum rather than
    // pretend the claim is already one of its members.
    if (claims.tokenType !== (expected as string)) {
      throw new BusinessException('INVALID_TOKEN_TYPE');
    }

    return {
      userId: String(claims.sub),
      role: this.normalizeRole(claims.role),
      sessionId: claims.sessionId,
    };
  }

  private normalizeRole(raw: string): Role {
    const name = raw?.startsWith('ROLE_') ? raw.substring('ROLE_'.length) : raw;
    if (name === (Role.ADMIN as string)) return Role.ADMIN;
    if (name === (Role.USER as string)) return Role.USER;
    throw new BusinessException('INVALID_TOKEN');
  }
}
