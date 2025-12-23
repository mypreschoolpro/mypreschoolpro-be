import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StripeProvider } from './providers/stripe.provider';
import { CardConnectProvider } from './providers/cardconnect.provider';
import {
  PaymentProvider,
  PaymentStatus as ProviderPaymentStatus,
  PaymentIntent,
} from './interfaces/payment.interface';
import {
  CreatePaymentOptions,
  CreateCustomerOptions,
} from './interfaces/payment-provider.interface';
import { Transaction } from './entities/transaction.entity';
import { Subscription } from './entities/subscription.entity';
import { PaymentStatus as DbPaymentStatus } from '../../common/enums/payment-status.enum';
import { DatabaseService } from '../../database/database.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { SchoolEntity, SchoolSubscriptionStatus } from '../schools/entities/school.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { LeadInvoice } from '../leads/entities/lead-invoice.entity';
import { MailerService } from '../mailer/mailer.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private stripeProvider: StripeProvider,
    private cardConnectProvider: CardConnectProvider,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(SchoolEntity)
    private readonly schoolRepository: Repository<SchoolEntity>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(LeadInvoice)
    private readonly leadInvoiceRepository: Repository<LeadInvoice>,
    private readonly mailerService: MailerService,
    private readonly databaseService: DatabaseService,
  ) {
    this.logger.log('Payments service initialized with multiple providers');
  }

  /**
   * Get the appropriate payment provider
   */
  private getProvider(provider: PaymentProvider) {
    switch (provider) {
      case PaymentProvider.STRIPE:
        return this.stripeProvider;
      case PaymentProvider.CARDCONNECT:
        return this.cardConnectProvider;
      default:
        throw new BadRequestException(`Unsupported payment provider: ${provider}`);
    }
  }

  /**
   * Create a payment with specified provider
   */
  async createPayment(
    provider: PaymentProvider,
    options: CreatePaymentOptions,
  ): Promise<{ payment: PaymentIntent; transaction: Transaction }> {
    this.logger.log(`Creating payment with ${provider}`);
    const paymentProvider = this.getProvider(provider);
    const payment = await paymentProvider.createPayment(options);
    const transaction = await this.recordTransaction(provider, payment, options);
    await this.handlePostPaymentActions(provider, payment, options, transaction);
    return { payment, transaction };
  }

  /**
   * Get payment details
   */
  async getPayment(provider: PaymentProvider, paymentId: string) {
    this.logger.log(`Retrieving payment ${paymentId} from ${provider}`);
    const paymentProvider = this.getProvider(provider);
    return paymentProvider.getPayment(paymentId);
  }

  /**
   * Create a customer
   */
  async createCustomer(provider: PaymentProvider, options: CreateCustomerOptions) {
    this.logger.log(`Creating customer with ${provider}`);
    const paymentProvider = this.getProvider(provider);
    return paymentProvider.createCustomer(options);
  }

  /**
   * Get customer details
   */
  async getCustomer(provider: PaymentProvider, customerId: string) {
    this.logger.log(`Retrieving customer ${customerId} from ${provider}`);
    const paymentProvider = this.getProvider(provider);
    return paymentProvider.getCustomer(customerId);
  }

  /**
   * Refund a payment
   */
  async refundPayment(provider: PaymentProvider, paymentId: string, amount?: number) {
    this.logger.log(`Refunding payment ${paymentId} with ${provider}`);
    const paymentProvider = this.getProvider(provider);
    return paymentProvider.refundPayment(paymentId, amount);
  }

  /**
   * Void a transaction (cancel before settlement)
   * Only supported for CardConnect
   */
  async voidTransaction(provider: PaymentProvider, paymentId: string) {
    this.logger.log(`Voiding transaction ${paymentId} with ${provider}`);
    
    if (provider !== PaymentProvider.CARDCONNECT) {
      throw new BadRequestException(`Void transaction not supported for ${provider}. Only CardConnect supports void transactions.`);
    }
    
    return this.cardConnectProvider.voidTransaction(paymentId);
  }

  /**
   * Verify webhook from provider
   */
  async verifyWebhook(provider: PaymentProvider, payload: any, signature: string) {
    this.logger.log(`Verifying webhook from ${provider}`);
    const paymentProvider = this.getProvider(provider);
    return paymentProvider.verifyWebhook(payload, signature);
  }

  private sanitizeMetadata(metadata: Record<string, any> = {}) {
    const { cardNumber, cvv, expiry, ...rest } = metadata;
    return rest;
  }

  private mapIntentStatusToDb(status: ProviderPaymentStatus): DbPaymentStatus {
    switch (status) {
      case ProviderPaymentStatus.SUCCEEDED:
        return DbPaymentStatus.PAID;
      case ProviderPaymentStatus.PENDING:
      case ProviderPaymentStatus.PROCESSING:
        return DbPaymentStatus.PENDING;
      case ProviderPaymentStatus.REFUNDED:
        return DbPaymentStatus.REFUNDED;
      default:
        return DbPaymentStatus.FAILED;
    }
  }

  private async recordTransaction(
    provider: PaymentProvider,
    payment: PaymentIntent,
    options: CreatePaymentOptions,
  ) {
    const metadata = options.metadata || {};
    const sanitizedMetadata = this.sanitizeMetadata(metadata);

    const transaction = this.transactionRepository.create({
      userId: sanitizedMetadata.userId || null,
      schoolId: sanitizedMetadata.schoolId || null,
      amount: payment.amount,
      currency: payment.currency || options.currency || 'usd',
      status: this.mapIntentStatusToDb(payment.status),
      paymentType: sanitizedMetadata.paymentType || provider,
      description: options.description || sanitizedMetadata.description || null,
      stripePaymentIntentId:
        provider === PaymentProvider.STRIPE ? payment.id : null,
      cardconnectTransactionId:
        provider === PaymentProvider.CARDCONNECT ? payment.id : null,
      metadata: {
        ...sanitizedMetadata,
        providerMetadata: payment.metadata,
      },
    });

    return this.transactionRepository.save(transaction);
  }

  private async handlePostPaymentActions(
    provider: PaymentProvider,
    payment: PaymentIntent,
    options: CreatePaymentOptions,
    transaction: Transaction,
  ) {
    if (provider !== PaymentProvider.CARDCONNECT) {
      return;
    }

    if (payment.status !== ProviderPaymentStatus.SUCCEEDED) {
      return;
    }

    const metadata = options.metadata || {};
    const nowIso = new Date().toISOString();

    if (metadata.paymentType === 'immediate_enrollment' && metadata.leadId) {
      await this.databaseService.query(
        `UPDATE leads 
         SET lead_status = $1, payment_status = $2, lead_score = $3, 
             last_activity_at = $4, updated_at = $4
         WHERE id = $5`,
        ['registered', 'paid', 300, nowIso, metadata.leadId],
      );

      const leadData = await this.databaseService.query(
        `SELECT school_id, program FROM leads WHERE id = $1`,
        [metadata.leadId],
      );

      if (leadData && leadData.length > 0) {
        await this.databaseService.query(
          `INSERT INTO enrollment (lead_id, school_id, program, status, start_date)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            metadata.leadId,
            leadData[0].school_id,
            leadData[0].program,
            'active',
            nowIso.split('T')[0],
          ],
        );
      }
    }

    // Handle subscription payments - update school subscription status
    if (metadata.paymentType && metadata.paymentType.startsWith('subscription') && metadata.schoolId) {
      // Extract subscription type from paymentType (e.g., "subscription_monthly" -> "monthly")
      const subscriptionType = metadata.paymentType.includes('_')
        ? metadata.paymentType.split('_')[1]
        : 'monthly'; // Default to monthly if not specified

      await this.updateSchoolSubscriptionAfterPayment(
        metadata.schoolId,
        options.amount,
        subscriptionType,
        transaction.id,
      );
    }

    // Handle standard invoice payments
    let invoiceNumber = metadata.invoiceNumber;
    if (metadata.invoiceId && (metadata.paymentType === 'invoice' || !metadata.paymentType)) {
      invoiceNumber = await this.updateInvoiceStatus(metadata.invoiceId, transaction.id);
    }

    // Handle lead invoice payments
    if (metadata.invoiceId && metadata.paymentType === 'lead_invoice') {
      const res = await this.updateLeadInvoiceStatus(metadata.invoiceId, transaction.id);
      if (res) invoiceNumber = res;
    }

    // Send payment confirmation email
    await this.sendPaymentConfirmationEmail(payment, options, transaction, invoiceNumber);

    this.logger.log(
      `CardConnect transaction persisted: ${transaction.cardconnectTransactionId}`,
    );
  }

  private async updateInvoiceStatus(invoiceId: string, transactionId: string): Promise<string | null> {
    try {
      const invoice = await this.invoiceRepository.findOne({ where: { id: invoiceId } });
      if (invoice) {
        invoice.status = DbPaymentStatus.PAID;
        invoice.paymentDate = new Date();
        invoice.transactionId = transactionId;
        await this.invoiceRepository.save(invoice);
        this.logger.log(`Invoice ${invoiceId} marked as paid`);
        return invoice.invoiceNumber;
      }
    } catch (error) {
      this.logger.error(`Failed to update invoice status: ${error.message}`);
    }
    return null;
  }

  private async updateLeadInvoiceStatus(invoiceId: string, transactionId: string): Promise<string | null> {
    try {
      const leadInvoice = await this.leadInvoiceRepository.findOne({ where: { id: invoiceId } });
      if (leadInvoice) {
        leadInvoice.status = 'paid';
        leadInvoice.paidAt = new Date();
        // Assuming there's a way to store transaction ID or just mark as paid
        await this.leadInvoiceRepository.save(leadInvoice);
        this.logger.log(`Lead Invoice ${invoiceId} marked as paid`);
        return leadInvoice.invoiceNumber;
      }
    } catch (error) {
      this.logger.error(`Failed to update lead invoice status: ${error.message}`);
    }
    return null;
  }

  private async sendPaymentConfirmationEmail(
    payment: PaymentIntent,
    options: CreatePaymentOptions,
    transaction: Transaction,
    invoiceNumber?: string,
  ): Promise<void> {
    try {
      const metadata = options.metadata || {};
      const recipientEmail = metadata.userEmail || metadata.email;
      const recipientName = metadata.name || metadata.cardholderName || 'Parent';

      if (!recipientEmail) {
        this.logger.warn('No recipient email found to send payment confirmation');
        return;
      }

      // Fetch school name if schoolId is available
      let schoolName = 'MyPreschoolPro';
      if (metadata.schoolId) {
        const school = await this.schoolRepository.findOne({
          where: { id: metadata.schoolId },
          select: ['name']
        });
        if (school) {
          schoolName = school.name;
        }
      }

      await this.mailerService.sendPaymentEmail({
        recipientEmail,
        recipientName,
        schoolName,
        amount: payment.amount,
        currency: payment.currency || 'USD',
        type: 'confirmation',
        paymentDate: new Date().toISOString(),
        invoiceNumber: invoiceNumber || metadata.invoiceNumber || metadata.invoiceId,
        schoolId: metadata.schoolId,
        userId: metadata.userId,
      });

      this.logger.log(`Payment confirmation email sent to ${recipientEmail}`);
    } catch (error) {
      this.logger.error(`Failed to send payment confirmation email: ${error.message}`);
    }
  }

  /**
   * Update school subscription after successful payment
   * Extends the existing subscription period or creates a new one
   */
  private async updateSchoolSubscriptionAfterPayment(
    schoolId: string,
    amount: number,
    paymentType: string,
    transactionId: string,
  ): Promise<void> {
    try {
      const school = await this.schoolRepository.findOne({
        where: { id: schoolId },
      });

      if (!school) {
        this.logger.warn(`School not found: ${schoolId}`);
        return;
      }

      // Determine months based on payment type
      // Payment types: monthly, quarterly, semi-annual, yearly
      let months = 1;
      const baseAmount = school.subscriptionAmount || 70000; // Default $700/month

      if (paymentType === 'monthly') {
        months = 1;
      } else if (paymentType === 'quarterly') {
        months = 3;
      } else if (paymentType === 'semi-annual') {
        months = 6;
      } else if (paymentType === 'yearly') {
        months = 12;
      } else {
        // Infer months from amount if paymentType is not specific
        const ratio = amount / baseAmount;
        if (Math.abs(ratio - 3) < 0.1) months = 3;
        else if (Math.abs(ratio - 6 * 0.9) < 0.1) months = 6; // 10% discount
        else if (Math.abs(ratio - 12 * 0.85) < 0.1) months = 12; // 15% discount
        else if (ratio >= 10) months = 12;
        else if (ratio >= 5) months = 6;
        else if (ratio >= 2.5) months = 3;
        else months = 1;
      }

      const now = new Date();

      // Calculate next payment due date
      // If there's an existing nextPaymentDue date in the future, extend from that date
      // Otherwise, extend from today
      let nextPaymentDue: Date;
      if (school.nextPaymentDue && school.nextPaymentDue > now) {
        // Extend existing subscription period
        nextPaymentDue = new Date(school.nextPaymentDue);
        nextPaymentDue.setMonth(nextPaymentDue.getMonth() + months);
        this.logger.log(
          `Extending existing subscription for school ${schoolId}: adding ${months} months to existing due date ${school.nextPaymentDue.toISOString()}`,
        );
      } else {
        // Start new subscription period from today
        nextPaymentDue = new Date(now);
        nextPaymentDue.setMonth(nextPaymentDue.getMonth() + months);
        this.logger.log(
          `Starting new subscription period for school ${schoolId}: ${months} months from today`,
        );
      }

      // Update school subscription
      school.subscriptionStatus = SchoolSubscriptionStatus.ACTIVE;
      school.lastPaymentDate = now;
      school.nextPaymentDue = nextPaymentDue;
      // Update paidInAdvancePeriod to reflect the new period type
      school.paidInAdvancePeriod = months;
      school.accessDisabled = false; // Re-enable access if it was disabled
      school.paymentRetryCount = 0; // Reset retry count

      await this.schoolRepository.save(school);

      this.logger.log(
        `Updated school ${schoolId} subscription: ${months} months (${paymentType}), next payment due: ${nextPaymentDue.toISOString()}, last payment: ${now.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Error updating school subscription after payment: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Cancel a subscription (CardConnect-compatible - database only)
   */
  async cancelSubscription(subscriptionId: string, userId: string): Promise<Subscription> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    // Check access: user must own the subscription or be associated with the school
    if (subscription.userId !== userId && subscription.schoolId) {
      // For school subscriptions, check if user is school owner
      const schoolCheck = await this.databaseService.query(
        `SELECT owner_id FROM schools WHERE id = $1`,
        [subscription.schoolId],
      );
      if (schoolCheck && schoolCheck.length > 0 && schoolCheck[0].owner_id !== userId) {
        throw new ForbiddenException('You do not have permission to cancel this subscription');
      }
    } else if (subscription.userId !== userId) {
      throw new ForbiddenException('You do not have permission to cancel this subscription');
    }

    subscription.cancelAtPeriodEnd = true;
    return this.subscriptionRepository.save(subscription);
  }

  /**
   * Update subscription plan (CardConnect-compatible - database only)
   */
  async updateSubscription(
    subscriptionId: string,
    userId: string,
    updateDto: UpdateSubscriptionDto,
  ): Promise<Subscription> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    // Check access
    if (subscription.userId !== userId && subscription.schoolId) {
      const schoolCheck = await this.databaseService.query(
        `SELECT owner_id FROM schools WHERE id = $1`,
        [subscription.schoolId],
      );
      if (schoolCheck && schoolCheck.length > 0 && schoolCheck[0].owner_id !== userId) {
        throw new ForbiddenException('You do not have permission to update this subscription');
      }
    } else if (subscription.userId !== userId) {
      throw new ForbiddenException('You do not have permission to update this subscription');
    }

    if (updateDto.planType) {
      subscription.planType = updateDto.planType;
    }
    if (updateDto.amount !== undefined) {
      subscription.amount = updateDto.amount;
    }

    return this.subscriptionRepository.save(subscription);
  }
}