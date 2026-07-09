import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entity/base.entity';
import { Role } from '../../../security/role.enum';

@Entity('users')
export class UserEntity extends BaseEntity {
  @Index('uniq_users_email', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  /** BCrypt hash. */
  @Column({ type: 'varchar', length: 255 })
  password!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: Role;
}
