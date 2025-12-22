import { ApiProperty } from '@nestjs/swagger';
import { LeadStatusType } from '../../../common/enums/lead-status-type.enum';
import { PaymentStatus } from '../../../common/enums/payment-status.enum';

export class ParentWaitlistItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  leadId: string;

  @ApiProperty()
  childName: string;

  @ApiProperty()
  schoolName: string;

  @ApiProperty()
  program: string;

  @ApiProperty()
  position: number;

  @ApiProperty({ enum: LeadStatusType })
  status: LeadStatusType;

  @ApiProperty()
  priorityScore: number;

  @ApiProperty({ required: false })
  updatedAt?: string;
}

export class ParentPaymentDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['lead_invoice', 'invoice'] })
  source: 'lead_invoice' | 'invoice';

  @ApiProperty({ description: 'Amount in cents' })
  amount: number;

  @ApiProperty({ default: 'usd' })
  currency: string;

  @ApiProperty({ enum: PaymentStatus, required: false })
  status: PaymentStatus | string;

  @ApiProperty({ required: false })
  dueDate?: string | null;

  @ApiProperty({ required: false })
  createdAt?: string;

  @ApiProperty({ required: false })
  childName?: string;

  @ApiProperty({ required: false })
  schoolName?: string;
}

export class ParentMessageDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  subject: string;

  @ApiProperty()
  content: string;

  @ApiProperty()
  isRead: boolean;

  @ApiProperty({ required: false })
  createdAt?: string;

  @ApiProperty({ required: false })
  studentId?: string | null;
}

export class ParentDashboardSummaryDto {
  @ApiProperty({ type: [ParentWaitlistItemDto] })
  waitlist: ParentWaitlistItemDto[];

  @ApiProperty({ type: [ParentPaymentDto] })
  payments: ParentPaymentDto[];

  @ApiProperty({ type: [ParentMessageDto] })
  messages: ParentMessageDto[];

  @ApiProperty()
  paymentRestricted: boolean;
}

export class ParentInvoiceDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  invoice_number: string;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  due_date: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  created_at: string;

  @ApiProperty({ nullable: true })
  payment_date: string | null;

  @ApiProperty({ nullable: true })
  notes: string | null;

  @ApiProperty({ enum: ['lead_invoice', 'invoice'] })
  source: 'lead_invoice' | 'invoice';

  @ApiProperty({ nullable: true })
  lead_id?: string | null;

  @ApiProperty()
  school_id: string;

  @ApiProperty({ nullable: true })
  transaction_id?: string | null;
}





