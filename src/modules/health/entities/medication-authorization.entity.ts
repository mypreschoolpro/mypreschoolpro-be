import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Student } from '../../students/entities/student.entity';
import { ProfileEntity } from '../../users/entities/profile.entity';
import { SchoolEntity } from '../../schools/entities/school.entity';

export enum AuthorizationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

@Entity('medication_authorizations')
export class MedicationAuthorization extends BaseEntity {
  @Column({ name: 'student_id', type: 'uuid' })
  studentId: string;

  @Column({ name: 'parent_id', type: 'uuid' })
  parentId: string;

  @Column({ name: 'school_id', type: 'uuid' })
  schoolId: string;

  @Column({ name: 'medication_name', type: 'varchar', length: 255 })
  medicationName: string;

  @Column({ type: 'varchar', length: 100 })
  dosage: string;

  @Column({ name: 'administration_times', type: 'time', array: true })
  administrationTimes: string[];

  @Column({ name: 'start_date', type: 'date' })
  startDate: Date;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: Date | null;

  @Column({ name: 'special_instructions', type: 'text', nullable: true })
  specialInstructions: string | null;

  @Column({ name: 'doctor_note_url', type: 'text', nullable: true })
  doctorNoteUrl: string | null;

  @Column({ name: 'prescription_url', type: 'text', nullable: true })
  prescriptionUrl: string | null;

  @Column({
    type: 'enum',
    enum: AuthorizationStatus,
    default: AuthorizationStatus.PENDING,
  })
  status: AuthorizationStatus;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  // Relations
  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @ManyToOne(() => ProfileEntity)
  @JoinColumn({ name: 'parent_id' })
  parent: ProfileEntity;

  @ManyToOne(() => ProfileEntity, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approvedByUser: ProfileEntity | null;

  @ManyToOne(() => SchoolEntity)
  @JoinColumn({ name: 'school_id' })
  school: SchoolEntity;
}







