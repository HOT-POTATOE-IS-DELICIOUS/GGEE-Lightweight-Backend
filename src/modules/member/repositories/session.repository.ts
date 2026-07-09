import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserSessionEntity } from '../entities/user-session.entity';

@Injectable()
export class SessionRepository {
  constructor(
    @InjectRepository(UserSessionEntity)
    private readonly repo: Repository<UserSessionEntity>,
  ) {}

  private scoped(manager?: EntityManager): Repository<UserSessionEntity> {
    return manager ? manager.getRepository(UserSessionEntity) : this.repo;
  }

  findBySessionId(sessionId: string): Promise<UserSessionEntity | null> {
    return this.repo.findOne({ where: { sessionId, deleted: false } });
  }

  save(session: UserSessionEntity, manager?: EntityManager): Promise<UserSessionEntity> {
    return this.scoped(manager).save(session);
  }

  /** Soft-delete all active sessions of a user (preserves the single-active-session invariant). */
  async invalidateByUserId(userId: string, manager?: EntityManager): Promise<number> {
    const result = await this.scoped(manager)
      .createQueryBuilder()
      .update(UserSessionEntity)
      .set({ deleted: true, deletedAt: () => 'CURRENT_TIMESTAMP' })
      .where('user_id = :userId AND deleted = false', { userId })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Compare-and-swap: rotate the refresh-token hash + expiry only if the stored hash still
   * matches `oldHash`. Returns affected row count (0 => reuse/race => caller rejects).
   */
  async updateRefreshTokenHash(
    sessionId: string,
    oldHash: string,
    newHash: string,
    newExpiresAt: Date,
    manager?: EntityManager,
  ): Promise<number> {
    const result = await this.scoped(manager)
      .createQueryBuilder()
      .update(UserSessionEntity)
      .set({ refreshTokenHash: newHash, expiresAt: newExpiresAt })
      .where('session_id = :sessionId AND refresh_token_hash = :oldHash AND deleted = false', {
        sessionId,
        oldHash,
      })
      .execute();
    return result.affected ?? 0;
  }
}
