import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { IndexingOutboxEntity, IndexingOutboxStatus } from '../entities/indexing-outbox.entity';

@Injectable()
export class IndexingOutboxRepository {
  constructor(
    @InjectRepository(IndexingOutboxEntity)
    private readonly repo: Repository<IndexingOutboxEntity>,
  ) {}

  private scoped(manager?: EntityManager): Repository<IndexingOutboxEntity> {
    return manager ? manager.getRepository(IndexingOutboxEntity) : this.repo;
  }

  save(outbox: IndexingOutboxEntity, manager?: EntityManager): Promise<IndexingOutboxEntity> {
    return this.scoped(manager).save(outbox);
  }

  /** PENDING/IN_PROGRESS -> PUBLISHED after a successful crawler dispatch. */
  async markPublished(id: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(IndexingOutboxEntity)
      .set({ status: IndexingOutboxStatus.PUBLISHED, publishedAt: () => 'CURRENT_TIMESTAMP' })
      .where('id = :id AND deleted = false', { id })
      .execute();
  }

  /** any -> COMPLETED when the crawler reports the job done (status=all_done). */
  async markCompleted(id: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(IndexingOutboxEntity)
      .set({ status: IndexingOutboxStatus.COMPLETED })
      .where('id = :id AND deleted = false', { id })
      .execute();
  }

  /** Used by the indexing-completion waiter (SSE long-poll). */
  async isCompleted(id: string): Promise<boolean> {
    if (!/^\d+$/.test(id)) return false; // non-numeric job id never completes (matches original)
    const count = await this.repo.count({
      where: { id, status: IndexingOutboxStatus.COMPLETED, deleted: false },
    });
    return count > 0;
  }
}
