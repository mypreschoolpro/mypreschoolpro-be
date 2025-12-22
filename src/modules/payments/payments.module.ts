import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StripeProvider } from './providers/stripe.provider';
import { CardConnectProvider } from './providers/cardconnect.provider';
import { Transaction } from './entities/transaction.entity';
import { Subscription } from './entities/subscription.entity';
import { StripeCustomer } from './entities/stripe-customer.entity';
import { Refund } from './entities/refund.entity';
import { AdHocCharge } from './entities/ad-hoc-charge.entity';
import { Payment } from './entities/payment.entity';
import { SchoolPayment } from '../schools/entities/school-payment.entity';
import { SchoolEntity } from '../schools/entities/school.entity';
import { DatabaseService } from '../../database/database.service';
import { Invoice } from '../invoices/entities/invoice.entity';
import { LeadInvoice } from '../leads/entities/lead-invoice.entity';
import { MailerModule } from '../mailer/mailer.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Transaction,
      Subscription,
      StripeCustomer,
      Refund,
      AdHocCharge,
      Payment,
      SchoolPayment,
      SchoolEntity,
      Invoice,
      LeadInvoice,
    ]),
    MailerModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeProvider, CardConnectProvider, DatabaseService],
  exports: [PaymentsService],
})
export class PaymentsModule { }