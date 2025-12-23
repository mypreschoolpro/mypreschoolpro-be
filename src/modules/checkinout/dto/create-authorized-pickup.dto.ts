import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsUUID, IsOptional, Matches } from 'class-validator';

export class CreateAuthorizedPickupDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  @IsNotEmpty()
  studentId: string;

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: 'Grandmother' })
  @IsString()
  @IsNotEmpty()
  relationship: string;

  @ApiProperty({ example: '+1-555-123-4567' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[\d\s\-()]+$/, { message: 'Invalid phone number format' })
  phone: string;

  @ApiProperty({ type: 'string', format: 'binary', required: false })
  @IsOptional()
  photoId?: Express.Multer.File;
}







