import { Controller, Post, Get, Patch, Body, Param, Query, Headers, RawBodyRequest, Req, UseGuards, Logger } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, CreateCustomerDto, RefundPaymentDto } from './dto/create-payment.dto';
import {
  PaymentResponseDto,
  PaymentIntentResponseDto,
  CustomerResponseDto,
  RefundResponseDto,
} from './dto/payment-response.dto';
import { PaymentProvider } from './interfaces/payment.interface';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { SchoolPaymentResponseDto } from './dto/school-payment-response.dto';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from './entities/subscription.entity';
import { Transaction } from './entities/transaction.entity';
import { SchoolPayment } from '../schools/entities/school-payment.entity';
import { SchoolEntity } from '../schools/entities/school.entity';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { AppRole } from '../../common/enums/app-role.enum';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private paymentsService: PaymentsService,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(SchoolPayment)
    private readonly schoolPaymentRepository: Repository<SchoolPayment>,
    @InjectRepository(SchoolEntity)
    private readonly schoolRepository: Repository<SchoolEntity>,
  ) {}

  /**
   * Create a payment intent
   * POST /api/payments/create
   */
  @Post('create')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create payment intent',
    description: `Create a payment intent with Stripe or CardConnect. Returns a client secret for completing the payment on the frontend.
    
**Provider-Specific Requirements:**

**Stripe:**
- Requires Stripe Elements on frontend for PCI compliance
- Returns clientSecret for payment confirmation
- Card data handled by Stripe.js

**CardConnect (Working Example):**
- Requires full card details in metadata
- Test card: 4005550000000019
- Supports billing address fields
- Direct authorization and capture`,
  })
  @ApiBody({
    type: CreatePaymentDto,
    examples: {
      stripe: {
        summary: 'Stripe Payment',
        description: 'Create a Stripe payment intent',
        value: {
          provider: 'stripe',
          amount: 5000,
          currency: 'usd',
          description: 'Monthly tuition payment',
          customerId: 'cus_123456789',
          metadata: {
            enrollmentId: 'enr_123',
            studentName: 'John Doe',
            month: 'January 2024',
          },
        },
      },
      cardconnect: {
        summary: 'CardConnect Payment (Verified Working)',
        description: 'Create a CardConnect payment with test card 4005550000000019',
        value: {
          provider: 'cardconnect',
          amount: 5000,
          currency: 'usd',
          description: 'Monthly tuition payment',
          metadata: {
            cardNumber: '4005550000000019',
            cvv: '123',
            expiry: '1225',
            name: 'John Doe',
            address: '123 Test Street',
            city: 'Pittsburgh',
            region: 'PA',
            postal: '15222',
            orderId: 'ORDER-001',
            enrollmentId: 'enr_123',
            studentName: 'John Doe',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Payment intent created successfully',
    type: PaymentIntentResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid payment data or provider configuration error',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: 'Amount must be at least $0.50' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Unauthorized' },
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Payment provider error',
  })
  async createPayment(
    @Body() createPaymentDto: CreatePaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      const { payment, transaction } = await this.paymentsService.createPayment(
        createPaymentDto.provider,
        {
          amount: createPaymentDto.amount,
          currency: createPaymentDto.currency,
          customerId: createPaymentDto.customerId,
          description: createPaymentDto.description,
          metadata: {
            ...createPaymentDto.metadata,
            userId: user.id,
            userEmail: user.email,
          },
        },
      );

      return {
        success: true,
        data: payment,
        transaction,
      };
    } catch (error) {
      this.logger.error(`Payment creation failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Process CardConnect payment using token from iframe tokenizer
   * POST /api/payments/process-cardconnect
   * Public endpoint for waitlist payments from public intake forms
   */
  @Public()
  @Post('process-cardconnect')
  @ApiOperation({
    summary: 'Process CardConnect payment with token',
    description: 'Process a payment using a token from CardConnect iframe tokenizer. This endpoint accepts tokenized payment data for PCI-compliant processing. Public endpoint for waitlist payments.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['token', 'amount'],
      properties: {
        token: {
          type: 'string',
          description: 'Payment token from CardConnect iframe tokenizer',
        },
        amount: {
          type: 'number',
          description: 'Amount in cents',
          example: 5000,
        },
        currency: {
          type: 'string',
          default: 'USD',
        },
        description: {
          type: 'string',
        },
        schoolId: {
          type: 'string',
          format: 'uuid',
        },
        invoiceId: {
          type: 'string',
          format: 'uuid',
        },
        leadId: {
          type: 'string',
          format: 'uuid',
        },
        paymentType: {
          type: 'string',
        },
        billingInfo: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
            address: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            zip: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Payment processed successfully',
  })
  async processCardConnectToken(
    @Body() body: {
      token: string;
      amount: number;
      currency?: string;
      description?: string;
      schoolId?: string;
      invoiceId?: string;
      leadId?: string;
      paymentType?: string;
      userId?: string; // Allow userId to be passed in body for public endpoints
      billingInfo?: {
        name?: string;
        email?: string;
        address?: string;
        city?: string;
        state?: string;
        zip?: string;
      };
    },
    @CurrentUser() user?: AuthUser,
  ) {
    try {
      // Use userId from body if provided (for public endpoints), otherwise use authenticated user
      const userId = body.userId || user?.id;
      const userEmail = user?.email || body.billingInfo?.email;
      
      const { payment, transaction } = await this.paymentsService.createPayment(
        PaymentProvider.CARDCONNECT,
        {
          amount: body.amount,
          currency: body.currency || 'USD',
          description: body.description,
          metadata: {
            token: body.token, // Use token instead of card data
            cardholderName: body.billingInfo?.name,
            name: body.billingInfo?.name,
            email: body.billingInfo?.email,
            address: body.billingInfo?.address,
            city: body.billingInfo?.city,
            region: body.billingInfo?.state,
            postal: body.billingInfo?.zip,
            invoiceId: body.invoiceId,
            paymentType: body.paymentType,
            leadId: body.leadId,
            userId: userId, // Use userId from body or authenticated user
            schoolId: body.schoolId, // Ensure schoolId is passed to metadata
            userEmail: userEmail,
          },
        },
      );

      return {
        success: true,
        transactionId: transaction.id,
        id: payment.id,
        data: payment,
        transaction,
      };
    } catch (error) {
      this.logger.error(`CardConnect token payment failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get payment details
   * GET /api/payments/:provider/:paymentId
   */
  @Get(':provider/:paymentId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get payment details',
    description: 'Retrieve detailed information about a specific payment by provider and payment ID',
  })
  @ApiParam({
    name: 'provider',
    description: 'Payment provider',
    enum: ['stripe', 'cardconnect'],
    example: 'stripe',
  })
  @ApiParam({
    name: 'paymentId',
    description: 'Payment intent ID',
    example: 'pi_123456789',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment details retrieved successfully',
    type: PaymentIntentResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid provider or payment ID',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
  })
  @ApiResponse({
    status: 404,
    description: 'Payment not found',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: 'Payment not found' },
      },
    },
  })
  async getPayment(
    @Param('provider') provider: string,
    @Param('paymentId') paymentId: string,
  ) {
    try {
      const payment = await this.paymentsService.getPayment(provider as any, paymentId);

      return {
        success: true,
        data: payment,
      };
    } catch (error) {
      this.logger.error(`Payment retrieval failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Create a customer
   * POST /api/payments/customers
   */
  @Post('customers')
  @UseGuards(JwtAuthGuard)
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create customer',
    description: `Create a customer profile in the payment provider system. This allows for saved payment methods and recurring billing. Admin only.
    
**CardConnect:** Creates a profile for storing payment methods. Requires card details in metadata.
**Stripe:** Creates a customer for recurring billing and saved payment methods.`,
  })
  @ApiBody({
    type: CreateCustomerDto,
    examples: {
      stripe: {
        summary: 'Stripe Customer',
        description: 'Create a Stripe customer profile',
        value: {
          provider: 'stripe',
          email: 'john.doe@example.com',
          name: 'John Doe',
          phone: '+1234567890',
          metadata: {
            parentId: 'par_123',
            schoolId: 'sch_456',
          },
        },
      },
      cardconnect: {
        summary: 'CardConnect Customer Profile',
        description: 'Create a CardConnect profile with saved payment method',
        value: {
          provider: 'cardconnect',
          email: 'john.doe@example.com',
          name: 'John Doe',
          phone: '+1234567890',
          metadata: {
            cardNumber: '4005550000000019',
            expiry: '1225',
            parentId: 'par_123',
            schoolId: 'sch_456',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Customer created successfully',
    type: CustomerResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid customer data',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 403 },
        message: { type: 'string', example: 'Forbidden resource' },
      },
    },
  })
  async createCustomer(
    @Body() createCustomerDto: CreateCustomerDto,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      const customer = await this.paymentsService.createCustomer(
        createCustomerDto.provider,
        {
          email: createCustomerDto.email,
          name: createCustomerDto.name,
          phone: createCustomerDto.phone,
          metadata: {
            ...createCustomerDto.metadata,
            createdBy: user.id,
          },
        },
      );

      return {
        success: true,
        data: customer,
      };
    } catch (error) {
      this.logger.error(`Customer creation failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Refund a payment
   * POST /api/payments/refund
   */
  @Post('refund')
  @UseGuards(JwtAuthGuard)
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Refund payment',
    description: 'Process a full or partial refund for a completed payment. Admin only.',
  })
  @ApiBody({ type: RefundPaymentDto })
  @ApiResponse({
    status: 201,
    description: 'Refund processed successfully',
    type: RefundResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid refund data or payment cannot be refunded',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: 'Payment already refunded' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions. Admin role required.',
  })
  async refundPayment(
    @Body() refundDto: RefundPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    try {
      this.logger.log(`User ${user.email} initiating refund for ${refundDto.paymentId}`);

      const refund = await this.paymentsService.refundPayment(
        refundDto.provider,
        refundDto.paymentId,
        refundDto.amount,
      );

      return {
        success: true,
        data: refund,
      };
    } catch (error) {
      this.logger.error(`Refund failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Stripe webhook
   * POST /api/payments/webhooks/stripe
   */
  @Public()
  @Post('webhooks/stripe')
  @ApiOperation({
    summary: 'Stripe webhook endpoint',
    description: 'Receive and process webhook events from Stripe. This endpoint is public but requires valid Stripe signature verification.',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
    schema: {
      type: 'object',
      properties: {
        received: { type: 'boolean', example: true },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid webhook signature or payload',
    schema: {
      type: 'object',
      properties: {
        received: { type: 'boolean', example: false },
        error: { type: 'string', example: 'Invalid signature' },
      },
    },
  })
  async handleStripeWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() request: any,
  ) {
    try {
      const event = await this.paymentsService.verifyWebhook(
        'stripe' as any,
        request.rawBody,
        signature,
      );

      this.logger.log(`Stripe webhook: ${event.type}`);

      // Handle different event types
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentSuccess(event.data.object, 'stripe');
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentFailed(event.data.object, 'stripe');
          break;
        // Add more event handlers
      }

      return { received: true };
    } catch (error) {
      this.logger.error(`Stripe webhook error: ${error.message}`);
      return { received: false, error: error.message };
    }
  }

  /**
   * CardConnect webhook
   * POST /api/payments/webhooks/cardconnect
   */
  @Public()
  @Post('webhooks/cardconnect')
  @ApiOperation({
    summary: 'CardConnect webhook endpoint',
    description: 'Receive and process webhook events from CardConnect. This endpoint is public but requires valid CardConnect signature verification.',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
    schema: {
      type: 'object',
      properties: {
        received: { type: 'boolean', example: true },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid webhook signature or payload',
    schema: {
      type: 'object',
      properties: {
        received: { type: 'boolean', example: false },
        error: { type: 'string', example: 'Invalid signature' },
      },
    },
  })
  async handleCardConnectWebhook(
    @Headers('x-cardconnect-signature') signature: string,
    @Body() payload: any,
  ) {
    try {
      const event = await this.paymentsService.verifyWebhook(
        'cardconnect' as any,
        payload,
        signature,
      );

      this.logger.log(`CardConnect webhook received`);

      // Handle CardConnect webhook events
      await this.handlePaymentSuccess(event, 'cardconnect');

      return { received: true };
    } catch (error) {
      this.logger.error(`CardConnect webhook error: ${error.message}`);
      return { received: false, error: error.message };
    }
  }

  /**
   * Handle successful payment (called by webhooks)
   */
  private async handlePaymentSuccess(paymentData: any, provider: string) {
    this.logger.log(`Payment succeeded via ${provider}: ${paymentData.id}`);
    // TODO: Update database, send confirmation email, etc.
  }

  /**
   * Handle failed payment (called by webhooks)
   */
  private async handlePaymentFailed(paymentData: any, provider: string) {
    this.logger.log(`Payment failed via ${provider}: ${paymentData.id}`);
    // TODO: Notify user, update status, etc.
  }

  /**
   * Get subscriptions
   * GET /api/payments/subscriptions
   */
  @Get('subscriptions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get subscriptions',
    description: 'Get all subscriptions for the authenticated user. For school owners, includes subscriptions for all owned schools.',
  })
  @ApiResponse({
    status: 200,
    description: 'Subscriptions retrieved successfully',
    type: [SubscriptionResponseDto],
  })
  async getSubscriptions(
    @CurrentUser() user: AuthUser,
    @Query('schoolId') schoolId?: string,
  ) {
    const queryBuilder = this.subscriptionRepository
      .createQueryBuilder('subscription')
      .leftJoinAndSelect('subscription.school', 'school')
      .orderBy('subscription.createdAt', 'DESC');

    // Access control: school owners can see all their schools' subscriptions
    if (user.primaryRole === AppRole.SCHOOL_OWNER) {
      const ownedSchools = await this.schoolRepository.find({
        where: { ownerId: user.id },
        select: ['id'],
      });
      const ownedSchoolIds = ownedSchools.map(s => s.id);
      if (ownedSchoolIds.length > 0) {
        queryBuilder.where('subscription.schoolId IN (:...schoolIds)', {
          schoolIds: ownedSchoolIds,
        });
      } else {
        return [];
      }
    } else if (schoolId) {
      queryBuilder.where('subscription.schoolId = :schoolId', { schoolId });
    } else if (user.schoolId) {
      queryBuilder.where('subscription.schoolId = :schoolId', { schoolId: user.schoolId });
    } else {
      queryBuilder.where('subscription.userId = :userId', { userId: user.id });
    }

    const subscriptions = await queryBuilder.getMany();

    return subscriptions.map(sub => ({
      id: sub.id,
      userId: sub.userId,
      schoolId: sub.schoolId,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      stripeCustomerId: sub.stripeCustomerId,
      status: sub.status,
      planType: sub.planType,
      amount: sub.amount,
      currency: sub.currency,
      currentPeriodStart: sub.currentPeriodStart?.toISOString() || null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() || null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      schoolName: sub.school?.name || null,
      createdAt: sub.createdAt.toISOString(),
      updatedAt: sub.updatedAt.toISOString(),
    }));
  }

  /**
   * Cancel subscription
   * PATCH /api/payments/subscriptions/:id/cancel
   */
  @Patch('subscriptions/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel subscription',
    description: 'Cancel a subscription at the end of the current period (CardConnect-compatible).',
  })
  @ApiParam({ name: 'id', description: 'Subscription ID' })
  @ApiResponse({
    status: 200,
    description: 'Subscription cancelled successfully',
    type: SubscriptionResponseDto,
  })
  async cancelSubscription(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() cancelDto: CancelSubscriptionDto,
  ) {
    const subscription = await this.paymentsService.cancelSubscription(id, user.id);
    return {
      id: subscription.id,
      userId: subscription.userId,
      schoolId: subscription.schoolId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      stripeCustomerId: subscription.stripeCustomerId,
      status: subscription.status,
      planType: subscription.planType,
      amount: subscription.amount,
      currency: subscription.currency,
      currentPeriodStart: subscription.currentPeriodStart?.toISOString() || null,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      createdAt: subscription.createdAt.toISOString(),
      updatedAt: subscription.updatedAt.toISOString(),
    };
  }

  /**
   * Update subscription
   * PATCH /api/payments/subscriptions/:id
   */
  @Patch('subscriptions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update subscription',
    description: 'Update subscription plan type or amount (CardConnect-compatible).',
  })
  @ApiParam({ name: 'id', description: 'Subscription ID' })
  @ApiResponse({
    status: 200,
    description: 'Subscription updated successfully',
    type: SubscriptionResponseDto,
  })
  async updateSubscription(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() updateDto: UpdateSubscriptionDto,
  ) {
    const subscription = await this.paymentsService.updateSubscription(id, user.id, updateDto);
    return {
      id: subscription.id,
      userId: subscription.userId,
      schoolId: subscription.schoolId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      stripeCustomerId: subscription.stripeCustomerId,
      status: subscription.status,
      planType: subscription.planType,
      amount: subscription.amount,
      currency: subscription.currency,
      currentPeriodStart: subscription.currentPeriodStart?.toISOString() || null,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      createdAt: subscription.createdAt.toISOString(),
      updatedAt: subscription.updatedAt.toISOString(),
    };
  }

  /**
   * Get school payments
   * GET /api/payments/school-payments
   */
  @Get('school-payments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get school payments',
    description: 'Get B2B subscription payment history. For school owners, includes payments for all owned schools.',
  })
  @ApiResponse({
    status: 200,
    description: 'School payments retrieved successfully',
    type: [SchoolPaymentResponseDto],
  })
  async getSchoolPayments(
    @CurrentUser() user: AuthUser,
    @Query('schoolId') schoolId?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    const queryBuilder = this.schoolPaymentRepository
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.school', 'school')
      .orderBy('payment.createdAt', 'DESC');

    // Access control
    if (user.primaryRole === AppRole.SCHOOL_OWNER) {
      const ownedSchools = await this.schoolRepository.find({
        where: { ownerId: user.id },
        select: ['id'],
      });
      const ownedSchoolIds = ownedSchools.map(s => s.id);
      if (ownedSchoolIds.length > 0) {
        queryBuilder.where('payment.schoolId IN (:...schoolIds)', {
          schoolIds: ownedSchoolIds,
        });
      } else {
        return [];
      }
    } else if (schoolId) {
      queryBuilder.where('payment.schoolId = :schoolId', { schoolId });
    } else if (user.schoolId) {
      queryBuilder.where('payment.schoolId = :schoolId', { schoolId: user.schoolId });
    }

    if (limit) {
      queryBuilder.limit(limit);
    }
    if (offset) {
      queryBuilder.offset(offset);
    }

    const payments = await queryBuilder.getMany();

    return payments.map(payment => ({
      id: payment.id,
      schoolId: payment.schoolId,
      amount: payment.amount,
      paymentType: payment.paymentType,
      paymentMethod: payment.paymentMethod,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      stripeInvoiceId: payment.stripeInvoiceId,
      stripeSessionId: payment.stripeSessionId,
      transactionReference: payment.transactionReference,
      paymentStatus: payment.paymentStatus,
      paymentDate: payment.paymentDate?.toISOString() || null,
      periodStart: payment.periodStart?.toISOString() || null,
      periodEnd: payment.periodEnd?.toISOString() || null,
      discountApplied: payment.discountApplied,
      notes: payment.notes,
      schoolName: payment.school?.name || null,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    }));
  }

  /**
   * Get transactions
   * GET /api/payments/transactions
   */
  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get transactions',
    description: 'Get payment transactions with filtering, search, sorting, and pagination support.',
  })
  @ApiQuery({
    name: 'schoolId',
    required: false,
    type: String,
    description: 'Filter by school ID',
  })
  @ApiQuery({
    name: 'paymentType',
    required: false,
    type: String,
    description: 'Filter by payment type (comma-separated for multiple values)',
    example: 'subscription,one_time_payment',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description: 'Filter by transaction status (comma-separated for multiple values, e.g., completed,paid)',
    example: 'completed,paid',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by transaction ID, description, or cardconnect/stripe transaction ID',
    example: '48727d14-24b0-4457-89ee-9f477a2cba1',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Filter transactions from this date (ISO 8601 format)',
    example: '2024-01-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'Filter transactions until this date (ISO 8601 format)',
    example: '2024-01-31T23:59:59Z',
  })
  @ApiQuery({
    name: 'minAmount',
    required: false,
    type: Number,
    description: 'Minimum amount in cents',
    example: 1000,
  })
  @ApiQuery({
    name: 'maxAmount',
    required: false,
    type: Number,
    description: 'Maximum amount in cents',
    example: 100000,
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    type: String,
    description: 'Sort by field (createdAt, amount)',
    example: 'createdAt',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    type: String,
    description: 'Sort order (asc, desc)',
    example: 'desc',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of transactions to return',
    example: 20,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of transactions to skip',
    example: 0,
  })
  @ApiResponse({
    status: 200,
    description: 'Transactions retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/TransactionResponseDto' },
        },
        total: { type: 'number', example: 100 },
      },
    },
  })
  async getTransactions(
    @CurrentUser() user: AuthUser,
    @Query('schoolId') schoolId?: string,
    @Query('paymentType') paymentType?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('minAmount') minAmount?: number,
    @Query('maxAmount') maxAmount?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    const queryBuilder = this.transactionRepository
      .createQueryBuilder('transaction')
      .leftJoinAndSelect('transaction.school', 'school');

    // Access control
    // Super admins can see all transactions (no filter applied)
    if (user.primaryRole === AppRole.SUPER_ADMIN) {
      // No filter - super admin sees all transactions
    } else if (user.primaryRole === AppRole.SCHOOL_OWNER) {
      const ownedSchools = await this.schoolRepository.find({
        where: { ownerId: user.id },
        select: ['id'],
      });
      const ownedSchoolIds = ownedSchools.map(s => s.id);
      if (ownedSchoolIds.length > 0) {
        queryBuilder.where('transaction.schoolId IN (:...schoolIds)', {
          schoolIds: ownedSchoolIds,
        });
      } else {
        return { data: [], total: 0 };
      }
    } else if (schoolId) {
      queryBuilder.where('transaction.schoolId = :schoolId', { schoolId });
    } else if (user.schoolId) {
      queryBuilder.where('transaction.schoolId = :schoolId', { schoolId: user.schoolId });
    } else {
      queryBuilder.where('transaction.userId = :userId', { userId: user.id });
    }

    // Filter by payment type
    if (paymentType && paymentType !== 'all') {
      const paymentTypes = paymentType.split(',');
      queryBuilder.andWhere('transaction.paymentType IN (:...paymentTypes)', {
        paymentTypes,
      });
    }

    // Filter by status
    if (status && status !== 'all') {
      const statuses = status.split(',');
      queryBuilder.andWhere('transaction.status IN (:...statuses)', {
        statuses,
      });
    }

    // Search filter - search by transaction ID, description, or cardconnect/stripe transaction ID
    // Cast UUID to text for ILIKE comparison
    if (search) {
      queryBuilder.andWhere(
        '(CAST(transaction.id AS TEXT) ILIKE :search OR transaction.description ILIKE :search OR transaction.cardconnectTransactionId ILIKE :search OR transaction.stripePaymentIntentId ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Date range filter
    if (startDate) {
      queryBuilder.andWhere('transaction.createdAt >= :startDate', {
        startDate: new Date(startDate),
      });
    }
    if (endDate) {
      queryBuilder.andWhere('transaction.createdAt <= :endDate', {
        endDate: new Date(endDate),
      });
    }

    // Amount range filter
    if (minAmount !== undefined) {
      queryBuilder.andWhere('transaction.amount >= :minAmount', {
        minAmount,
      });
    }
    if (maxAmount !== undefined) {
      queryBuilder.andWhere('transaction.amount <= :maxAmount', {
        maxAmount,
      });
    }

    // Sorting
    const sortField = sortBy === 'amount' ? 'transaction.amount' : 'transaction.createdAt';
    const sortDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';
    queryBuilder.orderBy(sortField, sortDirection);

    // Get total count before pagination
    const total = await queryBuilder.getCount();

    // Pagination
    if (limit) {
      queryBuilder.limit(limit);
    }
    if (offset) {
      queryBuilder.offset(offset);
    }

    const transactions = await queryBuilder.getMany();

    return {
      data: transactions.map(transaction => ({
        id: transaction.id,
        userId: transaction.userId,
        schoolId: transaction.schoolId,
        subscriptionId: transaction.subscriptionId,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        paymentType: transaction.paymentType,
        description: transaction.description,
        stripePaymentIntentId: transaction.stripePaymentIntentId,
        stripeSessionId: transaction.stripeSessionId,
        cardconnectTransactionId: transaction.cardconnectTransactionId,
        metadata: transaction.metadata,
        schoolName: transaction.school?.name || null,
        createdAt: transaction.createdAt.toISOString(),
        updatedAt: transaction.updatedAt.toISOString(),
      })),
      total,
    };
  }

  /**
   * Get transactions sum
   * GET /api/payments/transactions/sum
   */
  @Get('transactions/sum')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get transactions sum',
    description: 'Get the sum of transaction amounts, optionally filtered by status.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description: 'Filter by transaction status (e.g., completed)',
    example: 'completed',
  })
  @ApiQuery({
    name: 'schoolId',
    required: false,
    type: String,
    description: 'Filter by school ID',
  })
  @ApiQuery({
    name: 'paymentType',
    required: false,
    type: String,
    description: 'Filter by payment type (e.g., subscription, waitlist_fee)',
    example: 'subscription',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Filter transactions from this date (ISO 8601 format)',
    example: '2024-01-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'Filter transactions until this date (ISO 8601 format)',
    example: '2024-01-31T23:59:59Z',
  })
  @ApiResponse({
    status: 200,
    description: 'Sum retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        sum: { type: 'number', example: 5000000 },
        count: { type: 'number', example: 10 },
      },
    },
  })
  async getTransactionsSum(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('schoolId') schoolId?: string,
    @Query('paymentType') paymentType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<{ sum: number; count: number }> {
    const queryBuilder = this.transactionRepository
      .createQueryBuilder('transaction')
      .select('SUM(transaction.amount)', 'sum')
      .addSelect('COUNT(transaction.id)', 'count');

    // Access control
    if (user.primaryRole === AppRole.SCHOOL_OWNER) {
      const ownedSchools = await this.schoolRepository.find({
        where: { ownerId: user.id },
        select: ['id'],
      });
      const ownedSchoolIds = ownedSchools.map(s => s.id);
      if (ownedSchoolIds.length > 0) {
        queryBuilder.where('transaction.schoolId IN (:...schoolIds)', {
          schoolIds: ownedSchoolIds,
        });
      } else {
        return { sum: 0, count: 0 };
      }
    } else if (schoolId) {
      queryBuilder.where('transaction.schoolId = :schoolId', { schoolId });
    } else if (user.schoolId) {
      queryBuilder.where('transaction.schoolId = :schoolId', { schoolId: user.schoolId });
    } else if (user.primaryRole !== AppRole.SUPER_ADMIN) {
      queryBuilder.where('transaction.userId = :userId', { userId: user.id });
    }

    // Status filtering (supports comma-separated values)
    if (status) {
      const statuses = status.split(',').map(s => s.trim());
      if (statuses.length === 1) {
        queryBuilder.andWhere('transaction.status = :status', { status: statuses[0] });
      } else {
        queryBuilder.andWhere('transaction.status IN (:...statuses)', { statuses });
      }
    }

    // Payment type filtering
    if (paymentType) {
      queryBuilder.andWhere('transaction.paymentType = :paymentType', { paymentType });
    }

    // Date filtering
    if (startDate) {
      queryBuilder.andWhere('transaction.created_at >= :startDate', { startDate });
    }
    if (endDate) {
      queryBuilder.andWhere('transaction.created_at <= :endDate', { endDate });
    }

    const result = await queryBuilder.getRawOne();
    return { 
      sum: parseInt(result?.sum || '0', 10),
      count: parseInt(result?.count || '0', 10)
    };
  }
}