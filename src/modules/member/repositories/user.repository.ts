import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { BusinessException } from '../../../common/error/business.exception';
import { UserEntity } from '../entities/user.entity';

@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repo: Repository<UserEntity>,
  ) {}

  private scoped(manager?: EntityManager): Repository<UserEntity> {
    return manager ? manager.getRepository(UserEntity) : this.repo;
  }

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { email, deleted: false } });
  }

  findById(id: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { id, deleted: false } });
  }

  /** Insert a new user. Unique-email violations map to EMAIL_ALREADY_EXISTS. */
  async save(user: UserEntity, manager?: EntityManager): Promise<UserEntity> {
    try {
      return await this.scoped(manager).save(user);
    } catch (err) {
      if (err instanceof QueryFailedError && this.isUniqueViolation(err.driverError)) {
        throw new BusinessException('EMAIL_ALREADY_EXISTS');
      }
      throw err;
    }
  }

  /**
   * `QueryFailedError` is generic over its driver error and TypeORM defaults that parameter to
   * `any`, so take it as `unknown` and narrow here rather than letting `any` leak into the caller.
   */
  private isUniqueViolation(driverError: unknown): boolean {
    // Postgres unique_violation SQLSTATE
    return (driverError as { code?: string } | null)?.code === '23505';
  }
}
