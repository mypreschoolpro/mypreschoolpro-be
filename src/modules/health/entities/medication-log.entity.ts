import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Student } from '../../students/entities/student.entity';
import { ProfileEntity } from '../../users/entities/profile.entity';
import { SchoolEntity } from '../../schools/entities/school.entity';
import { MedicationAuthorization } from './medication-authorization.entity';

export enum AdministrationStatus {
  ADMINISTERED = 'administered',
  MISSED = 'missed',
  REFUSED = 'refused',
}

@Entity('medication_logs')
export class MedicationLog extends BaseEntity {
  @Column({ name: 'authorization_id', type: 'uuid' })
  authorizationId: string;

  @Column({ name: 'student_id', type: 'uuid' })
  studentId: string;

  @Column({ name: 'administered_by', type: 'uuid' })
  administeredBy: string;

  @Column({ name: 'school_id', type: 'uuid' })
  schoolId: string;

  @Column({ name: 'administration_time', type: 'timestamptz' })
  administrationTime: Date;

  @Column({ type: 'varchar', length: 100 })
  dosage: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'photo_url', type: 'text', nullable: true })
  photoUrl: string | null;

  @Column({ name: 'parent_notified', type: 'boolean', default: false })
  parentNotified: boolean;

  @Column({
    type: 'enum',
    enum: AdministrationStatus,
    default: AdministrationStatus.ADMINISTERED,
  })
  status: AdministrationStatus;

  // Relations
  @ManyToOne(() => MedicationAuthorization)
  @JoinColumn({ name: 'authorization_id' })
  authorization: MedicationAuthorization;

  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @ManyToOne(() => ProfileEntity)
  @JoinColumn({ name: 'administered_by' })
  administeredByUser: ProfileEntity;

  @ManyToOne(() => SchoolEntity)
  @JoinColumn({ name: 'school_id' })
  school: SchoolEntity;
}







