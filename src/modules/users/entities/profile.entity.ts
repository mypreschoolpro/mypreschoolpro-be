import { Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { UserRoleEntity } from './user-role.entity';

@Entity('profiles')
export class ProfileEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120, nullable: true, name: 'first_name' })
  firstName: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true, name: 'last_name' })
  lastName: string | null;

  @Column({ type: 'varchar', length: 256, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  phone: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  state: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true, name: 'zip_code' })
  zipCode: string | null;

  @Column({ type: 'text', nullable: true, name: 'avatar_url' })
  avatarUrl: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'school_id' })
  schoolId: string | null;

  @Column({ type: 'varchar', length: 64, default: 'active' })
  status: string;

  @Column({ type: 'integer', default: 0, name: 'login_count' })
  loginCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => UserRoleEntity, (role) => role.profile)
  roles: UserRoleEntity[];
}


