import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Student } from '../../students/entities/student.entity';
import { ProfileEntity } from '../../users/entities/profile.entity';
import { SchoolEntity } from '../../schools/entities/school.entity';

@Entity('illness_logs')
export class IllnessLog extends BaseEntity {
  @Column({ name: 'student_id', type: 'uuid' })
  studentId: string;

  @Column({ name: 'reported_by', type: 'uuid' })
  reportedBy: string;

  @Column({ name: 'school_id', type: 'uuid' })
  schoolId: string;

  @Column({ name: 'illness_date', type: 'timestamptz' })
  illnessDate: Date;

  @Column({ type: 'text', array: true, default: [] })
  symptoms: string[];

  @Column({ type: 'decimal', precision: 4, scale: 1, nullable: true })
  temperature: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'pickup_recommended', type: 'boolean', default: false })
  pickupRecommended: boolean;

  @Column({ name: 'parent_notified', type: 'boolean', default: false })
  parentNotified: boolean;

  @Column({ name: 'doctor_note_url', type: 'text', nullable: true })
  doctorNoteUrl: string | null;

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







