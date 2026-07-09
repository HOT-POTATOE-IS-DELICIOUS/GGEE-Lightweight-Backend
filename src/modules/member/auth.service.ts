import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { BusinessException } from '../../common/error/business.exception';
import { SnowflakeService } from '../../common/snowflake/snowflake.service';
import { AuthUser } from '../../security/auth-user';
import { Role } from '../../security/role.enum';
import { ProtectService } from '../protect/protect.service';
import { PasswordHasher } from './crypto/password.hasher';
import { RefreshTokenHasher } from './crypto/refresh-token.hasher';
import {
  LoginRequestDto,
  RefreshRequestDto,
  RegisterRequestDto,
  RegisterResponse,
  TokenPairResponse,
} from './dto/auth.dto';
import { UserEntity } from './entities/user.entity';
import { UserSessionEntity } from './entities/user-session.entity';
import { TokenService } from './jwt/token.service';
import { SessionRepository } from './repositories/session.repository';
import { UserRepository } from './repositories/user.repository';

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

@Injectable()
export class AuthService {
  private readonly refreshActiveMs: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenService,
    private readonly passwordHasher: PasswordHasher,
    private readonly refreshHasher: RefreshTokenHasher,
    private readonly snowflake: SnowflakeService,
    private readonly protect: ProtectService,
    config: ConfigService,
  ) {
    this.refreshActiveMs = config.getOrThrow<number>('jwt.refreshTokenActiveTimeMs');
  }

  /**
   * Register: user + protect + indexing job + session in one transaction; the crawler index
   * request (replacing the Kafka publish) fires *after* the transaction commits.
   */
  async register(dto: RegisterRequestDto): Promise<RegisterResponse> {
    if (!EMAIL_REGEX.test(dto.email)) {
      throw new BusinessException('INVALID_EMAIL_FORMAT');
    }
    const hashedPassword = await this.passwordHasher.hash(dto.password);

    const { indexingJobId, tokens, target, info } = await this.dataSource.transaction(
      async (manager: EntityManager) => {
        const user = manager.getRepository(UserEntity).create({
          id: this.snowflake.generateId(),
          email: dto.email,
          password: hashedPassword,
          role: Role.USER,
          deleted: false,
          deletedAt: null,
        });
        await this.users.save(user, manager);

        const indexResult = await this.protect.index(
          { userId: user.id, target: dto.protect_target, info: dto.protect_target_info },
          manager,
        );

        const tokenPair = await this.createSession(user, manager);
        return {
          indexingJobId: indexResult.indexingJobId,
          tokens: tokenPair,
          target: dto.protect_target,
          info: dto.protect_target_info,
        };
      },
    );

    // Fire-and-forget dispatch to the crawler (was: Kafka `crawl.request`). Not awaited: the tx has
    // committed, so its outcome cannot change this response — the client learns it from the
    // indexing waiter instead. ProtectService drains any in-flight dispatch on shutdown.
    this.protect.scheduleIndexing(indexingJobId, target, info);

    return {
      indexing_job_id: indexingJobId,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    };
  }

  /** Login: verify credentials, then rotate the single active session in one transaction. */
  async login(dto: LoginRequestDto): Promise<TokenPairResponse> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) {
      throw new BusinessException('INVALID_EMAIL_OR_PASSWORD');
    }
    const ok = await this.passwordHasher.matches(dto.password, user.password);
    if (!ok) {
      throw new BusinessException('INVALID_EMAIL_OR_PASSWORD');
    }

    const tokens = await this.dataSource.transaction(async (manager) => {
      await this.sessions.invalidateByUserId(user.id, manager);
      return this.createSession(user, manager);
    });

    return { access_token: tokens.accessToken, refresh_token: tokens.refreshToken };
  }

  /** Refresh: rotate tokens via a compare-and-swap on the stored refresh-token hash. */
  async refresh(dto: RefreshRequestDto): Promise<TokenPairResponse> {
    const principal = this.tokens.resolveRefresh(dto.refresh_token);
    const oldHash = this.refreshHasher.hash(dto.refresh_token);

    const newAccessToken = this.tokens.generateAccessToken(principal);
    const newRefreshToken = this.tokens.generateRefreshToken(principal);
    const newHash = this.refreshHasher.hash(newRefreshToken);
    const newExpiresAt = new Date(Date.now() + this.refreshActiveMs);

    const session = await this.sessions.findBySessionId(principal.sessionId);
    if (!session) {
      throw new BusinessException('INVALID_SESSION');
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new BusinessException('SESSION_EXPIRED');
    }

    const affected = await this.sessions.updateRefreshTokenHash(
      principal.sessionId,
      oldHash,
      newHash,
      newExpiresAt,
    );
    if (affected === 0) {
      // Stored hash no longer matches oldHash: reuse-after-rotation or a multi-tab race.
      throw new BusinessException('INVALID_SESSION');
    }

    return { access_token: newAccessToken, refresh_token: newRefreshToken };
  }

  async logout(userId: string): Promise<void> {
    await this.sessions.invalidateByUserId(userId);
  }

  private async createSession(
    user: UserEntity,
    manager: EntityManager,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const sessionId = this.snowflake.generateId();
    const principal: AuthUser = { userId: user.id, role: user.role, sessionId };

    const accessToken = this.tokens.generateAccessToken(principal);
    const refreshToken = this.tokens.generateRefreshToken(principal);
    const refreshTokenHash = this.refreshHasher.hash(refreshToken);

    const session = manager.getRepository(UserSessionEntity).create({
      id: this.snowflake.generateId(),
      userId: user.id,
      sessionId,
      refreshTokenHash,
      expiresAt: new Date(Date.now() + this.refreshActiveMs),
      deleted: false,
      deletedAt: null,
    });
    await this.sessions.save(session, manager);

    return { accessToken, refreshToken };
  }
}
