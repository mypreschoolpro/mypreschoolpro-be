import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Student } from '../../students/entities/student.entity';
import { ProfileEntity } from '../../users/entities/profile.entity';

@Entity('authorized_pickup_persons')
export class AuthorizedPickupPerson extends BaseEntity {
  @Column({ name: 'student_id', type: 'uuid' })
  studentId: string;

  @Column({ name: 'parent_id', type: 'uuid' })
  parentId: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName: string;

  @Column({ type: 'varchar', length: 100 })
  relationship: string;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ name: 'photo_id_url', type: 'text', nullable: true })
  photoIdUrl: string | null;

  @Column({ name: 'unique_code', type: 'varchar', length: 10, unique: true })
  uniqueCode: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'revoked_by', type: 'uuid', nullable: true })
  revokedBy: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  // Relations
  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @ManyToOne(() => ProfileEntity)
  @JoinColumn({ name: 'parent_id' })
  parent: ProfileEntity;

  @ManyToOne(() => ProfileEntity, { nullable: true })
  @JoinColumn({ name: 'revoked_by' })
  revokedByUser: ProfileEntity | null;
}







