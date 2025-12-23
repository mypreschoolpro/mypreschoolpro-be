import { ApiProperty } from '@nestjs/swagger';

export class CheckInOutResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  studentId: string;

  @ApiProperty({ example: 'John Doe' })
  studentName: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  checkedInBy: string;

  @ApiProperty({ example: 'Jane Parent' })
  checkedInByName: string;

  @ApiProperty({ example: '2024-01-15T08:00:00Z' })
  checkInTime: Date;

  @ApiProperty({ example: '2024-01-15T15:30:00Z', nullable: true })
  checkOutTime: Date | null;

  @ApiProperty({ example: true })
  checkInVerified: boolean;

  @ApiProperty({ example: false })
  checkOutVerified: boolean;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  schoolId: string;
}







