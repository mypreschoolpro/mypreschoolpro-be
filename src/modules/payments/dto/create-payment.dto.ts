import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, IsOptional, IsEnum, IsObject, Min } from 'class-validator';
import { PaymentProvider } from '../interfaces/payment.interface';

export class CreatePaymentDto {
  @ApiProperty({
    description: 'Payment provider to use',
    enum: PaymentProvider,
    example: PaymentProvider.STRIPE,
    required: true,
  })
  @IsEnum(PaymentProvider)
  provider: PaymentProvider;

  @ApiProperty({
    description: 'Payment amount in cents (e.g., 5000 = $50.00)',
    example: 5000,
    minimum: 50,
    required: true,
  })
  @IsNumber()
  @Min(50) // Minimum $0.50
  amount: number;

  @ApiProperty({
    description: 'Currency code (ISO 4217)',
    example: 'usd',
    default: 'usd',
    required: false,
  })
  @IsOptional()
  @IsString()
  currency?: string = 'usd';

  @ApiProperty({
    description: 'Existing customer ID from the payment provider',
    example: 'cus_123456789',
    required: false,
  })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiProperty({
    description: 'Payment description or purpose',
    example: 'Monthly tuition payment for John Doe',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Additional metadata for the payment. For CardConnect, include card details and billing information.',
    examples: {
      stripe: {
        summary: 'Stripe metadata',
        value: { enrollmentId: 'enr_123', studentName: 'John Doe', month: 'January 2024' },
      },
      cardconnect: {
        summary: 'CardConnect payment details (working example)',
        value: {
          cardNumber: '4005550000000019',
          cvv: '123',
          expiry: '1225',
          name: 'John Doe',
          address: '123 Test Street',
          city: 'Pittsburgh',
          region: 'PA',
          postal: '15222',
          orderId: 'ORDER-001',
        },
      },
    },
    required: false,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class CreateCustomerDto {
  @ApiProperty({
    description: 'Payment provider to use',
    enum: PaymentProvider,
    example: PaymentProvider.STRIPE,
    required: true,
  })
  @IsEnum(PaymentProvider)
  provider: PaymentProvider;

  @ApiProperty({
    description: 'Customer email address',
    example: 'john.doe@example.com',
    required: true,
  })
  @IsString()
  email: string;

  @ApiProperty({
    description: 'Customer full name',
    example: 'John Doe',
    required: true,
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Customer phone number',
    example: '+1234567890',
    required: false,
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    description: 'Additional metadata for the customer',
    example: { parentId: 'par_123', schoolId: 'sch_456' },
    required: false,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class RefundPaymentDto {
  @ApiProperty({
    description: 'Payment provider',
    enum: PaymentProvider,
    example: PaymentProvider.STRIPE,
    required: true,
  })
  @IsEnum(PaymentProvider)
  provider: PaymentProvider;

  @ApiProperty({
    description: 'Payment ID to refund',
    example: 'pi_123456789',
    required: true,
  })
  @IsString()
  paymentId: string;

  @ApiProperty({
    description: 'Refund amount in cents (omit for full refund)',
    example: 2500,
    minimum: 1,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;

  @ApiProperty({
    description: 'Reason for the refund',
    example: 'Customer requested cancellation',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class VoidPaymentDto {
  @ApiProperty({
    description: 'Payment provider',
    enum: PaymentProvider,
    example: PaymentProvider.CARDCONNECT,
    required: true,
  })
  @IsEnum(PaymentProvider)
  provider: PaymentProvider;

  @ApiProperty({
    description: 'Payment ID (retref) to void',
    example: '123456789012',
    required: true,
  })
  @IsString()
  paymentId: string;
}