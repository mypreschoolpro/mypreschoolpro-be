import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CalendarEventType } from '../entities/calendar-event.entity';

export class CreateCalendarEventDto {
  @ApiProperty({ description: 'School ID', example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  @IsNotEmpty()
  schoolId: string;

  @ApiPropertyOptional({
    description: 'Class ID (NULL for school-wide events)',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiProperty({ description: 'Event title', example: 'Spring Break', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ description: 'Event description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Start date', example: '2025-03-15', format: 'date' })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiPropertyOptional({ description: 'End date (for multi-day events)', example: '2025-03-22', format: 'date' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Start time (for timed events)', example: '09:00', format: 'time' })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional({ description: 'End time (for timed events)', example: '17:00', format: 'time' })
  @IsOptional()
  @IsString()
  endTime?: string;

  @ApiProperty({
    description: 'Event type',
    enum: CalendarEventType,
    example: CalendarEventType.HOLIDAY,
  })
  @IsEnum(CalendarEventType)
  eventType: CalendarEventType;

  @ApiPropertyOptional({ description: 'Location', example: 'Main Campus', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional({ description: 'Whether event is all-day', default: true })
  @IsOptional()
  @IsBoolean()
  isAllDay?: boolean;
}






