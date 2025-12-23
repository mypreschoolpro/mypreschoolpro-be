import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CalendarEventType } from '../entities/calendar-event.entity';

export class CalendarEventResponseDto {
  @ApiProperty({ description: 'Event ID' })
  id: string;

  @ApiProperty({ description: 'School ID' })
  schoolId: string;

  @ApiPropertyOptional({ description: 'Class ID (null for school-wide events)' })
  classId: string | null;

  @ApiProperty({ description: 'Event title' })
  title: string;

  @ApiPropertyOptional({ description: 'Event description' })
  description: string | null;

  @ApiProperty({ description: 'Start date', format: 'date' })
  startDate: string;

  @ApiPropertyOptional({ description: 'End date', format: 'date' })
  endDate: string | null;

  @ApiPropertyOptional({ description: 'Start time', format: 'time' })
  startTime: string | null;

  @ApiPropertyOptional({ description: 'End time', format: 'time' })
  endTime: string | null;

  @ApiProperty({ description: 'Event type', enum: CalendarEventType })
  eventType: CalendarEventType;

  @ApiPropertyOptional({ description: 'Location' })
  location: string | null;

  @ApiProperty({ description: 'Whether event is all-day' })
  isAllDay: boolean;

  @ApiProperty({ description: 'Whether event is school-wide' })
  isSchoolWide: boolean;

  @ApiProperty({ description: 'Created by user ID' })
  createdBy: string;

  @ApiProperty({ description: 'Created at', format: 'date-time' })
  createdAt: string;

  @ApiProperty({ description: 'Updated at', format: 'date-time' })
  updatedAt: string;
}






