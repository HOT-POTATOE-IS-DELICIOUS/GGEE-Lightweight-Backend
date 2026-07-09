import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { IndexingJobEntity, IndexingJobStatus } from '../entities/indexing-job.entity';

@Injectable()
export class IndexingJobRepository {
  constructor(
    @InjectRepository(IndexingJobEntity)
    private readonly repo: Repository<IndexingJobEntity>,
  ) {}

  private scoped(manager?: EntityManager): Repository<IndexingJobEntity> {
    return manager ? manager.getRepository(IndexingJobEntity) : this.repo;
  }

  save(job: IndexingJobEntity, manager?: EntityManager): Promise<IndexingJobEntity> {
    return this.scoped(manager).save(job);
  }

  /** PENDING -> COMPLETED when the crawler reports the job done (status=all_done). */
  async markCompleted(id: string): Promise<void> {
    await this.setStatus(id, IndexingJobStatus.COMPLETED);
  }

  /** PENDING -> FAILED when the synchronous crawler dispatch never lands. */
  async markFailed(id: string): Promise<void> {
    await this.setStatus(id, IndexingJobStatus.FAILED);
  }

  /**
   * Terminal states are sticky: an `all_done` callback that races a dispatch timeout must not be
   * overwritten by the losing FAILED write, and vice versa.
   */
  private async setStatus(id: string, status: IndexingJobStatus): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(IndexingJobEntity)
      .set({ status })
      .where('id = :id AND deleted = false AND status = :pending', {
        id,
        pending: IndexingJobStatus.PENDING,
      })
      .execute();
  }

  /** Used by the indexing-completion waiter (SSE long-poll). Unknown/malformed id -> null. */
  async findStatus(id: string): Promise<IndexingJobStatus | null> {
    if (!/^\d+$/.test(id)) return null; // id is a bigint; a non-numeric param would blow up the query
    const job = await this.repo.findOne({
      where: { id, deleted: false },
      select: { status: true },
    });
    return job?.status ?? null;
  }
}
