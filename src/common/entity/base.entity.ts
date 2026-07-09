import { Column, CreateDateColumn, PrimaryColumn } from 'typeorm';

/**
 * Port of `infrastructure.r2dbc.common.BaseEntity`.
 *
 *  - id         : snowflake `bigint` PK, app-generated (NOT auto-increment). The pg driver
 *                 returns bigint columns as strings, so `id` is typed `string` in JS.
 *  - createdAt  : quoted mixed-case column literally named "createdAt".
 *  - deleted    : explicit boolean soft-delete flag (NOT TypeORM @DeleteDateColumn semantics).
 *  - deletedAt  : nullable timestamp.
 *
 * There is intentionally no `updatedAt` (dropped in the original V20260505 migration).
 * Every read query in the app filters `deleted = false`.
 */
export abstract class BaseEntity {
  @PrimaryColumn({ type: 'bigint' })
  id!: string;

  @CreateDateColumn({ name: 'createdAt', type: 'timestamp' })
  createdAt!: Date;

  @Column({ type: 'boolean', default: false })
  deleted!: boolean;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;
}
