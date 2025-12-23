import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsEnum, IsDateString } from 'class-validator';
import { IncidentType, SeverityLevel, IncidentStatus } from '../entities/incident-report.entity';

export class IncidentFilterDto {
  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  studentId?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  schoolId?: string;

  @ApiProperty({ enum: IncidentType, required: false })
  @IsEnum(IncidentType)
  @IsOptional()
  type?: IncidentType;

  @ApiProperty({ enum: SeverityLevel, required: false })
  @IsEnum(SeverityLevel)
  @IsOptional()
  severity?: SeverityLevel;

  @ApiProperty({ enum: IncidentStatus, required: false })
  @IsEnum(IncidentStatus)
  @IsOptional()
  status?: IncidentStatus;

  @ApiProperty({ example: '2025-01-01', required: false })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiProperty({ example: '2025-01-31', required: false })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}







