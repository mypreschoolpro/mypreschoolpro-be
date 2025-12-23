import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Student } from '../../students/entities/student.entity';
import { ProfileEntity } from '../../users/entities/profile.entity';
import { SchoolEntity } from '../../schools/entities/school.entity';

export enum IncidentType {
  FALL = 'fall',
  INJURY = 'injury',
  ALTERCATION = 'altercation',
  MEDICAL_EMERGENCY = 'medical_emergency',
  ALLERGIC_REACTION = 'allergic_reaction',
  OTHER = 'other',
}

export enum SeverityLevel {
  MINOR = 'minor',
  MODERATE = 'moderate',
  MAJOR = 'major',
}

export enum IncidentStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
  FOLLOW_UP_REQUIRED = 'follow_up_required',
}

@Entity('incident_reports')
export class IncidentReport extends BaseEntity {
  @Column({ name: 'student_id', type: 'uuid' })
  studentId: string;

  @Column({ name: 'reported_by', type: 'uuid' })
  reportedBy: string;

  @Column({ name: 'school_id', type: 'uuid' })
  schoolId: string;

  @Column({ name: 'incident_date', type: 'timestamptz' })
  incidentDate: Date;

  @Column({ type: 'varchar', length: 100 })
  location: string;

  @Column({
    type: 'enum',
    enum: IncidentType,
  })
  type: IncidentType;

  @Column({
    type: 'enum',
    enum: SeverityLevel,
  })
  severity: SeverityLevel;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'action_taken', type: 'text', nullable: true })
  actionTaken: string | null;

  @Column({ type: 'text', array: true, default: [] })
  witnesses: string[];

  @Column({ name: 'photo_urls', type: 'text', array: true, default: [] })
  photoUrls: string[];

  @Column({ name: 'parent_notified', type: 'boolean', default: false })
  parentNotified: boolean;

  @Column({ name: 'parent_acknowledged', type: 'boolean', default: false })
  parentAcknowledged: boolean;

  @Column({ name: 'parent_acknowledged_at', type: 'timestamptz', nullable: true })
  parentAcknowledgedAt: Date | null;

  @Column({
    type: 'enum',
    enum: IncidentStatus,
    default: IncidentStatus.OPEN,
  })
  status: IncidentStatus;

  @Column({ name: 'follow_up_notes', type: 'jsonb', nullable: true })
  followUpNotes: Array<{ date: Date; note: string; authorId: string }> | null;

  // Relations
  @ManyToOne(() => Student)
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @ManyToOne(() => ProfileEntity)
  @JoinColumn({ name: 'reported_by' })
  reportedByUser: ProfileEntity;

  @ManyToOne(() => SchoolEntity)
  @JoinColumn({ name: 'school_id' })
  school: SchoolEntity;
}







