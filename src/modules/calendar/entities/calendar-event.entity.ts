import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { SchoolEntity } from '../../schools/entities/school.entity';
import { ClassEntity } from '../../classes/entities/class.entity';
import { ProfileEntity } from '../../users/entities/profile.entity';

export enum CalendarEventType {
  HOLIDAY = 'holiday',
  CLOSURE = 'closure',
  FIELD_TRIP = 'field_trip',
  ACTIVITY = 'activity',
  MEETING = 'meeting',
  SPECIAL_EVENT = 'special_event',
  PARENT_TEACHER_CONFERENCE = 'parent_teacher_conference',
  OTHER = 'other',
}

@Entity('calendar_events')
export class CalendarEvent extends BaseEntity {
  @Column({ name: 'school_id', type: 'uuid' })
  schoolId: string;

  @Column({ name: 'class_id', type: 'uuid', nullable: true })
  classId: string | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'start_date', type: 'date' })
  startDate: Date;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: Date | null;

  @Column({ name: 'start_time', type: 'time', nullable: true })
  startTime: string | null;

  @Column({ name: 'end_time', type: 'time', nullable: true })
  endTime: string | null;

  @Column({
    name: 'event_type',
    type: 'enum',
    enum: CalendarEventType,
  })
  eventType: CalendarEventType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  location: string | null;

  @Column({ name: 'is_all_day', type: 'boolean', default: true })
  isAllDay: boolean;

  @Column({ name: 'is_school_wide', type: 'boolean', default: false })
  isSchoolWide: boolean;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  // Relations
  @ManyToOne(() => SchoolEntity)
  @JoinColumn({ name: 'school_id' })
  school: SchoolEntity;

  @ManyToOne(() => ClassEntity, { nullable: true })
  @JoinColumn({ name: 'class_id' })
  class: ClassEntity | null;

  @ManyToOne(() => ProfileEntity)
  @JoinColumn({ name: 'created_by' })
  creator: ProfileEntity;
}






