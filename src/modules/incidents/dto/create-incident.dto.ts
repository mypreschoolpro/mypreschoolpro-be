import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsEnum,
  IsOptional,
  IsArray,
  IsDateString,
  IsBoolean,
} from 'class-validator';
import { IncidentType, SeverityLevel } from '../entities/incident-report.entity';

export class CreateIncidentDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  @IsNotEmpty()
  studentId: string;

  @ApiProperty({ example: '2025-01-15T10:30:00Z' })
  @IsDateString()
  @IsNotEmpty()
  incidentDate: string;

  @ApiProperty({ example: 'Playground' })
  @IsString()
  @IsNotEmpty()
  location: string;

  @ApiProperty({ enum: IncidentType, example: IncidentType.FALL })
  @IsEnum(IncidentType)
  @IsNotEmpty()
  type: IncidentType;

  @ApiProperty({ enum: SeverityLevel, example: SeverityLevel.MINOR })
  @IsEnum(SeverityLevel)
  @IsNotEmpty()
  severity: SeverityLevel;

  @ApiProperty({ example: 'Student fell while playing on the slide' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 'Applied ice pack and monitored', required: false })
  @IsString()
  @IsOptional()
  actionTaken?: string;

  @ApiProperty({ example: ['John Doe', 'Jane Smith'], required: false, type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  witnesses?: string[];

  @ApiProperty({ example: ['https://s3.../photo1.jpg'], required: false, type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  photoUrls?: string[];
}







