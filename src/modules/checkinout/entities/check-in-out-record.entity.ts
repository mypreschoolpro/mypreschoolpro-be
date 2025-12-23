import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Student } from '../../students/entities/student.entity';
import { ProfileEntity } from '../../users/entities/profile.entity';
import { SchoolEntity } from '../../schools/entities/school.entity';

@Entity('check_in_out_records')
export class CheckInOutRecord extends BaseEntity {
  @Column({ name: 'student_id', type: 'uuid' })
  studentId: string;

  @Column({ name: 'checked_in_by', type: 'uuid' })
  checkedInBy: string;

  @Column({ name: 'check_in_time', type: 'timestamptz' })
  checkInTime: Date;

  @Column({ name: 'check_out_time', type: 'timestamptz', nullable: true })
  checkOutTime: Date | null;

  @Column({ name: 'check_in_signature', type: 'text' })
  checkInSignature: string;

  @Column({ name: 'check_out_signature', type: 'text', nullable: true })
  checkOutSignature: string | null;

  @Column({ name: 'check_in_location', type: 'jsonb', nullable: true })
  checkInLocation: { lat: number; lng: number; accuracy?: number } | null;

  @Column({ name: 'check_out_location', type: 'jsonb', nullable: true })
  checkOutLocation: { lat: number; lng: number; accuracy?: number } | null;

  @Column({ name: 'check_in_verified', type: 'boolean', default: false })
  checkInVerified: boolean;

  @Column({ name: 'check_out_verified', type: 'boolean', default: false })
  checkOutVerified: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'school_id', type: 'uuid' })
  schoolId: string;

  // Relations
  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @ManyToOne(() => ProfileEntity)
  @JoinColumn({ name: 'checked_in_by' })
  checkedInByUser: ProfileEntity;

  @ManyToOne(() => SchoolEntity)
  @JoinColumn({ name: 'school_id' })
  school: SchoolEntity;
}







