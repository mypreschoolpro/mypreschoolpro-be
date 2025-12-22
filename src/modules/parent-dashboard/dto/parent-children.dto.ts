import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ParentMessageType } from '../../communications/entities/parent-message.entity';

export class ParentChildEnrollmentDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  startDate: string | null;

  @ApiPropertyOptional()
  endDate: string | null;

  @ApiPropertyOptional()
  tuitionAmount: number | null;

  @ApiPropertyOptional()
  classId: string | null;
}

export class ParentChildWaitlistDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  position: number | null;

  @ApiPropertyOptional()
  program: string | null;

  @ApiPropertyOptional()
  createdAt: string | null;
}

export class ParentChildProgressDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  subject: string;

  @ApiProperty()
  progressPercentage: number;

  @ApiPropertyOptional()
  teacherComments: string | null;

  @ApiPropertyOptional()
  assessmentDate: string | null;
}

export class ParentChildActivityDto {
  @ApiProperty()
  activityType: string;

  @ApiPropertyOptional()
  notes: string | null;

  @ApiProperty()
  createdAt: string;
}

export class ParentChildDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  childName: string;

  @ApiPropertyOptional()
  childBirthdate: string | null;

  @ApiPropertyOptional()
  program: string | null;

  @ApiProperty()
  leadStatus: string;

  @ApiProperty()
  schoolId: string;

  @ApiPropertyOptional()
  schoolName: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiPropertyOptional({ type: ParentChildEnrollmentDto })
  enrollment?: ParentChildEnrollmentDto | null;

  @ApiPropertyOptional({ type: ParentChildWaitlistDto })
  waitlist?: ParentChildWaitlistDto | null;

  @ApiPropertyOptional({ type: [ParentChildProgressDto] })
  progress?: ParentChildProgressDto[];

  @ApiPropertyOptional()
  studentId?: string | null;

  @ApiPropertyOptional()
  teacherId?: string | null;

  @ApiPropertyOptional()
  teacherName?: string | null;

  @ApiPropertyOptional()
  isCheckedIn?: boolean;

  @ApiPropertyOptional({ type: [ParentChildActivityDto] })
  recentActivities?: ParentChildActivityDto[];
}

export class ParentDailyReportDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  reportDate: string;

  @ApiPropertyOptional()
  activities: string | null;

  @ApiPropertyOptional()
  meals: string | null;

  @ApiPropertyOptional()
  napTime: string | null;

  @ApiPropertyOptional()
  moodBehavior: string | null;

  @ApiPropertyOptional()
  notes: string | null;

  @ApiPropertyOptional()
  leadId?: string;

  @ApiPropertyOptional()
  childName?: string;
}

export class SendParentMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({ enum: ParentMessageType })
  @IsOptional()
  @IsEnum(ParentMessageType)
  messageType?: ParentMessageType;
}

export class ParentAttendanceDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  date: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  notes: string | null;

  @ApiProperty()
  studentId: string;

  @ApiPropertyOptional()
  leadId: string | null;

  @ApiPropertyOptional()
  teacherId: string | null;

  @ApiProperty()
  createdAt: string;
}

export class ParentProgressDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  subject: string;

  @ApiProperty()
  progressPercentage: number;

  @ApiPropertyOptional()
  grade: string | null;

  @ApiPropertyOptional()
  teacherComments: string | null;

  @ApiPropertyOptional()
  assessmentDate: string | null;

  @ApiProperty()
  studentId: string;

  @ApiPropertyOptional()
  leadId: string | null;

  @ApiProperty()
  createdAt: string;
}

export class ParentMediaDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  childId: string;

  @ApiProperty()
  fileUrl: string;

  @ApiProperty()
  fileName: string;

  @ApiProperty()
  fileType: string;

  @ApiPropertyOptional()
  description: string | null;

  @ApiProperty()
  createdAt: string;
}

export class ParentReportsQueryDto {
  @ApiProperty({ description: 'Page number (1-indexed)', example: 1, required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ description: 'Number of items per page', example: 10, required: false, default: 10, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiProperty({ description: 'Search term for child name, activities, meals, notes', example: 'John', required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ description: 'Filter by child ID (leadId)', example: 'uuid', required: false })
  @IsOptional()
  @IsString()
  childId?: string;

  @ApiProperty({ description: 'Field to sort by', example: 'reportDate', required: false, enum: ['reportDate', 'createdAt'] })
  @IsOptional()
  @IsEnum(['reportDate', 'createdAt'])
  sortBy?: 'reportDate' | 'createdAt' = 'reportDate';

  @ApiProperty({ description: 'Sort order', example: 'desc', required: false, enum: ['asc', 'desc'] })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class ParentReportsResponseDto {
  @ApiProperty({ type: [ParentDailyReportDto] })
  data: Array<ParentDailyReportDto & { leadId: string; childName: string }>;

  @ApiProperty()
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}




