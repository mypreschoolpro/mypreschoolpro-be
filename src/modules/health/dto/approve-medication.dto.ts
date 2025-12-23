import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AuthorizationStatus } from '../entities/medication-authorization.entity';

export class ApproveMedicationDto {
  @ApiProperty({ enum: AuthorizationStatus, example: AuthorizationStatus.APPROVED })
  @IsEnum(AuthorizationStatus)
  @IsOptional()
  status?: AuthorizationStatus;

  @ApiProperty({ example: 'Missing doctor signature', required: false })
  @IsString()
  @IsOptional()
  rejectionReason?: string;
}







