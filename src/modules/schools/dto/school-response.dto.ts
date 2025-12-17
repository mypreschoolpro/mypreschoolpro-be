import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SchoolStatus, SchoolSubscriptionStatus } from '../entities/school.entity';

export class SchoolResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the school',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'School name',
    example: 'Little Stars Preschool',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'Full address of the school',
    example: '123 Main Street, Springfield, IL 62704',
    nullable: true,
  })
  address: string | null;

  @ApiPropertyOptional({
    description: 'Phone number',
    example: '+1-555-123-4567',
    nullable: true,
  })
  phone: string | null;

  @ApiPropertyOptional({
    description: 'Email address',
    example: 'info@littlestars.com',
    nullable: true,
  })
  email: string | null;

  @ApiPropertyOptional({
    description: 'Owner user ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    nullable: true,
  })
  ownerId: string | null;

  @ApiProperty({
    description: 'Maximum capacity of the school',
    example: 120,
  })
  capacity: number;

  @ApiProperty({
    description: 'Programs offered by the school',
    type: [String],
    example: ['Toddler Program', 'Preschool Program'],
  })
  programsOffered: string[];

  @ApiProperty({
    description: 'School status',
    enum: SchoolStatus,
    example: SchoolStatus.ACTIVE,
  })
  status: SchoolStatus;

  @ApiProperty({
    description: 'Subscription status',
    enum: SchoolSubscriptionStatus,
    example: SchoolSubscriptionStatus.ACTIVE,
  })
  subscriptionStatus: SchoolSubscriptionStatus;

  @ApiPropertyOptional({
    description: 'Next payment due date',
    example: '2024-01-15T10:30:00Z',
    nullable: true,
  })
  nextPaymentDue: Date | null;

  @ApiPropertyOptional({
    description: 'Stripe customer ID',
    example: 'cus_123456789',
    nullable: true,
  })
  stripeCustomerId: string | null;

  @ApiPropertyOptional({
    description: 'Stripe subscription ID',
    example: 'sub_123456789',
    nullable: true,
  })
  stripeSubscriptionId: string | null;

  @ApiProperty({
    description: 'Subscription amount (in cents)',
    example: 70000,
  })
  subscriptionAmount: number;

  @ApiProperty({
    description: 'Paid in advance period (in months)',
    example: 6,
  })
  paidInAdvancePeriod: number;

  @ApiPropertyOptional({
    description: 'Discounted amount (in cents)',
    example: 5000,
    nullable: true,
  })
  discountedAmount: number | null;

  @ApiProperty({
    description: 'Whether access is disabled due to billing issues',
    example: false,
  })
  accessDisabled: boolean;

  @ApiPropertyOptional({
    description: 'Last payment date',
    example: '2024-01-10T12:00:00Z',
    nullable: true,
  })
  lastPaymentDate: Date | null;

  @ApiProperty({
    description: 'Number of consecutive payment retry attempts',
    example: 0,
  })
  paymentRetryCount: number;

  @ApiPropertyOptional({
    description: 'Latitude coordinate',
    example: 37.7749,
    nullable: true,
  })
  latitude: number | null;

  @ApiPropertyOptional({
    description: 'Longitude coordinate',
    example: -122.4194,
    nullable: true,
  })
  longitude: number | null;

  @ApiProperty({
    description: 'Timestamp when the school was created',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Timestamp when the school was last updated',
    example: '2024-01-15T10:30:00Z',
  })
  updatedAt: Date;
}