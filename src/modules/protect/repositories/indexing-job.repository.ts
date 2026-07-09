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

  /**
   * -> COMPLETED when the crawler reports the job done (status=all_done). Overrides FAILED: a
   * dispatch that timed out on our side may still have been received, and the crawler's callback
   * is ground truth about the crawl where our HTTP timeout is only a guess about the request.
   */
  async markCompleted(id: string): Promise<void> {
    await this.setStatus(id, IndexingJobStatus.COMPLETED, [
      IndexingJobStatus.PENDING,
      IndexingJobStatus.FAILED,
    ]);
  }

  /**
   * PENDING -> FAILED when the crawler dispatch never lands. Never overrides COMPLETED, so a
   * dispatch timeout racing an already-delivered `all_done` cannot bury the completion.
   */
  async markFailed(id: string): Promise<void> {
    await this.setStatus(id, IndexingJobStatus.FAILED, [IndexingJobStatus.PENDING]);
  }

  private async setStatus(
    id: string,
    status: IndexingJobStatus,
    from: IndexingJobStatus[],
  ): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(IndexingJobEntity)
      .set({ status })
      .where('id = :id AND deleted = false AND status IN (:...from)', { id, from })
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
