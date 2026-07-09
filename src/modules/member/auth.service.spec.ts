import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { SnowflakeService } from '../../common/snowflake/snowflake.service';
import { Role } from '../../security/role.enum';
import { ProtectService } from '../protect/protect.service';
import { AuthService } from './auth.service';
import { LoginRequestDto, RefreshRequestDto, RegisterRequestDto } from './dto/auth.dto';
import { TokenService } from './jwt/token.service';
import { SessionRepository } from './repositories/session.repository';
import { UserRepository } from './repositories/user.repository';

const REFRESH_MS = 1_209_600_000;

describe('AuthService', () => {
  let service: AuthService;
  let log: string[];

  // Mocks (typed loosely; only the used methods are stubbed).
  let dataSource: DataSource;
  let users: { save: jest.Mock; findByEmail: jest.Mock };
  let sessions: {
    invalidateByUserId: jest.Mock;
    save: jest.Mock;
    findBySessionId: jest.Mock;
    updateRefreshTokenHash: jest.Mock;
  };
  let tokens: {
    generateAccessToken: jest.Mock;
    generateRefreshToken: jest.Mock;
    resolveRefresh: jest.Mock;
  };
  let passwordHasher: { hash: jest.Mock; matches: jest.Mock };
  let refreshHasher: { hash: jest.Mock };
  let protect: { index: jest.Mock; scheduleIndexing: jest.Mock };

  const fakeManager = {
    getRepository: () => ({ create: (o: any) => o }),
  } as unknown as EntityManager;

  beforeEach(() => {
    log = [];

    dataSource = {
      transaction: jest.fn(async (cb: any) => {
        log.push('tx:start');
        const result = await cb(fakeManager);
        log.push('tx:end');
        return result;
      }),
    } as unknown as DataSource;

    users = {
      save: jest.fn(async (u: any) => {
        log.push('users.save');
        return u;
      }),
      findByEmail: jest.fn(),
    };

    sessions = {
      invalidateByUserId: jest.fn(async () => {
        log.push('sessions.invalidate');
        return 1;
      }),
      save: jest.fn(async (s: any) => {
        log.push('sessions.save');
        return s;
      }),
      findBySessionId: jest.fn(),
      updateRefreshTokenHash: jest.fn(),
    };

    tokens = {
      generateAccessToken: jest.fn(() => 'access'),
      generateRefreshToken: jest.fn(() => 'refresh'),
      resolveRefresh: jest.fn(),
    };

    passwordHasher = {
      hash: jest.fn(async () => {
        log.push('password.hash');
        return 'hashed-pw';
      }),
      matches: jest.fn(),
    };

    refreshHasher = {
      hash: jest.fn((input: string) => `hash(${input})`),
    };

    let counter = 0;
    const snowflake = {
      generateId: jest.fn(() => `id-${++counter}`),
    } as unknown as SnowflakeService;

    protect = {
      index: jest.fn(async () => {
        log.push('protect.index');
        return { protectId: 'p-1', indexingJobId: 'job-1' };
      }),
      scheduleIndexing: jest.fn(() => {
        log.push('protect.scheduleIndexing');
      }),
    };

    const config = {
      getOrThrow: (key: string) => {
        if (key === 'jwt.refreshTokenActiveTimeMs') return REFRESH_MS;
        throw new Error(`unexpected config key: ${key}`);
      },
    } as unknown as ConfigService;

    service = new AuthService(
      dataSource,
      users as unknown as UserRepository,
      sessions as unknown as SessionRepository,
      tokens as unknown as TokenService,
      passwordHasher,
      refreshHasher,
      snowflake,
      protect as unknown as ProtectService,
      config,
    );
  });

  const registerDto = (): RegisterRequestDto => ({
    email: 'user@example.com',
    password: 'pw12345678',
    protect_target: '홍길동',
    protect_target_info: 'info',
  });

  describe('register', () => {
    it('rejects a malformed email before hashing (INVALID_EMAIL_FORMAT)', async () => {
      const dto = { ...registerDto(), email: 'not-an-email' };
      await expect(service.register(dto)).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_EMAIL_FORMAT' }),
      );
      expect(passwordHasher.hash).not.toHaveBeenCalled();
    });

    it('saves the user, indexes inside the tx, then schedules indexing AFTER commit', async () => {
      const result = await service.register(registerDto());

      expect(result).toEqual({
        indexing_job_id: 'job-1',
        access_token: 'access',
        refresh_token: 'refresh',
      });
      // protect.index happens inside the transaction; scheduleIndexing strictly after tx:end.
      expect(log).toEqual([
        'password.hash',
        'tx:start',
        'users.save',
        'protect.index',
        'sessions.save',
        'tx:end',
        'protect.scheduleIndexing',
      ]);
      expect(protect.scheduleIndexing).toHaveBeenCalledWith('job-1', '홍길동', 'info');
    });
  });

  describe('login', () => {
    it('rejects an unknown email (INVALID_EMAIL_OR_PASSWORD)', async () => {
      users.findByEmail.mockResolvedValue(null);
      const dto: LoginRequestDto = { email: 'user@example.com', password: 'pw12345678' };
      await expect(service.login(dto)).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_EMAIL_OR_PASSWORD' }),
      );
    });

    it('rejects a wrong password (INVALID_EMAIL_OR_PASSWORD)', async () => {
      users.findByEmail.mockResolvedValue({ id: 'u-1', password: 'stored' } as any);
      passwordHasher.matches.mockResolvedValue(false);
      const dto: LoginRequestDto = { email: 'user@example.com', password: 'wrong' };
      await expect(service.login(dto)).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_EMAIL_OR_PASSWORD' }),
      );
    });

    it('invalidates existing sessions BEFORE saving the new one, and returns tokens', async () => {
      users.findByEmail.mockResolvedValue({
        id: 'u-1',
        password: 'stored',
        role: Role.USER,
      } as any);
      passwordHasher.matches.mockResolvedValue(true);

      const result = await service.login({
        email: 'user@example.com',
        password: 'pw12345678',
      });

      expect(result).toEqual({ access_token: 'access', refresh_token: 'refresh' });
      expect(log.indexOf('sessions.invalidate')).toBeLessThan(log.indexOf('sessions.save'));
    });
  });

  describe('refresh', () => {
    const dto: RefreshRequestDto = { refresh_token: 'old-raw' };
    const principal = { userId: 'u-1', role: Role.USER, sessionId: 's-1' };

    beforeEach(() => {
      tokens.resolveRefresh.mockReturnValue(principal);
    });

    it('rejects when the session is not found (INVALID_SESSION)', async () => {
      sessions.findBySessionId.mockResolvedValue(null);
      await expect(service.refresh(dto)).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_SESSION' }),
      );
    });

    it('rejects an expired session (SESSION_EXPIRED)', async () => {
      sessions.findBySessionId.mockResolvedValue({
        expiresAt: new Date(Date.now() - 1000),
      } as any);
      await expect(service.refresh(dto)).rejects.toThrow(
        expect.objectContaining({ code: 'SESSION_EXPIRED' }),
      );
    });

    it('rejects a CAS miss / token reuse when 0 rows are affected (INVALID_SESSION)', async () => {
      sessions.findBySessionId.mockResolvedValue({
        expiresAt: new Date(Date.now() + 100_000),
      } as any);
      sessions.updateRefreshTokenHash.mockResolvedValue(0);
      await expect(service.refresh(dto)).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_SESSION' }),
      );
    });

    it('rotates tokens and passes the OLD hash as the CAS predicate', async () => {
      sessions.findBySessionId.mockResolvedValue({
        expiresAt: new Date(Date.now() + 100_000),
      } as any);
      sessions.updateRefreshTokenHash.mockResolvedValue(1);

      const result = await service.refresh(dto);

      expect(result).toEqual({ access_token: 'access', refresh_token: 'refresh' });
      const [sessionId, oldHash, newHash] = sessions.updateRefreshTokenHash.mock.calls[0];
      expect(sessionId).toBe('s-1');
      expect(oldHash).toBe('hash(old-raw)'); // CAS predicate = hash of the presented token
      expect(newHash).toBe('hash(refresh)'); // hash of the freshly issued refresh token
    });
  });

  describe('logout', () => {
    it('delegates to sessions.invalidateByUserId(userId)', async () => {
      await service.logout('u-42');
      expect(sessions.invalidateByUserId).toHaveBeenCalledWith('u-42');
    });
  });
});
