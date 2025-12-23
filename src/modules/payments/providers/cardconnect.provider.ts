import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IPaymentProvider, CreatePaymentOptions, CreateCustomerOptions } from '../interfaces/payment-provider.interface';
import { PaymentIntent, PaymentCustomer, PaymentProvider, PaymentStatus, RefundResult } from '../interfaces/payment.interface';

interface CardConnectConfig {
  apiUrl: string;
  username: string;
  password: string;
  mid: string; // Merchant ID
  isProduction: boolean;
}

interface CardConnectResponse {
  respstat?: string; // "A" = approved, "B" = retry, "C" = declined
  respcode?: string;
  resptext?: string;
  respmsg?: string;
  retref?: string; // Retrieval reference
  amount?: string;
  merchantid?: string;
  account?: string; // Masked card number
  token?: string;
  expiry?: string;
  name?: string;
  authcode?: string; // Authorization code
  cvvresp?: string;
  avsresp?: string;
  orderid?: string;
  invoiceid?: string;
}

@Injectable()
export class CardConnectProvider implements IPaymentProvider {
  private readonly logger = new Logger(CardConnectProvider.name);
  private config: CardConnectConfig;

  constructor(private configService: ConfigService) {
    const isProduction = this.configService.get<string>('CARDCONNECT_PRODUCTION') === 'true';

    if (isProduction) {
      this.config = {
        apiUrl: this.configService.get('CARDCONNECT_API_URL') || '',
        username: this.configService.get('CARDCONNECT_USERNAME') || '',
        password: this.configService.get('CARDCONNECT_PASSWORD') || '',
        mid: this.configService.get('CARDCONNECT_MID') || '',
        isProduction: true,
      };
    } else {
      // Sandbox/UAT configuration
      // Note: These are default test credentials - you may need to use your actual CardConnect sandbox credentials
      this.config = {
        apiUrl: this.configService.get('CARDCONNECT_API_URL') || 'https://fts-uat.cardconnect.com/cardconnect/rest',
        username: this.configService.get('CARDCONNECT_USERNAME') || 'testing',
        password: this.configService.get('CARDCONNECT_PASSWORD') || 'testing123',
        mid: this.configService.get('CARDCONNECT_MID') || '800000019079',
        isProduction: false,
      };
    }

    // Validate configuration
    if (!this.config.apiUrl || !this.config.username || !this.config.password || !this.config.mid) {
      this.logger.warn('CardConnect configuration incomplete. Some credentials may be missing.');
    }

    this.logger.log(`CardConnect provider initialized (${isProduction ? 'Production' : 'Sandbox'})`);
  }

  /**
   * Get Basic Auth header (matches your implementation)
   */
  private getAuthHeader(): string {
    const credentials = `${this.config.username}:${this.config.password}`;
    const base64 = Buffer.from(credentials).toString('base64');
    const authHeader = `Basic ${base64}`;
    
    // Log auth header for debugging (without exposing password)
    this.logger.debug('CardConnect Auth Header:', {
      username: this.config.username,
      hasPassword: !!this.config.password,
      headerLength: authHeader.length,
    });
    
    return authHeader;
  }

  /**
   * Create payment (authorize and capture)
   * Supports both token-based (from iframe tokenizer) and direct card data
   */
  async createPayment(options: CreatePaymentOptions): Promise<PaymentIntent> {
    try {
      this.logger.log(`Creating CardConnect payment for ${options.amount} cents`);

      const metadata = options.metadata || {};
      // Check if using token (from iframe tokenizer) or direct card data
      const isTokenPayment = !!metadata.token;
      const isDirectPayment = !!(metadata.cardNumber && metadata.expiry && metadata.cvv);

      if (!isTokenPayment && !isDirectPayment) {
        throw new BadRequestException('CardConnect requires either a token (from iframe tokenizer) or card number, expiry, and CVV');
      }

      // Build payload according to CardPointe API specification
      const payload: any = {
        merchid: this.config.mid, // API uses 'merchid', not 'merchantid'
        amount: (options.amount / 100).toFixed(2), // Amount as string with 2 decimal places (e.g., "100.00")
        currency: (options.currency || 'USD').toUpperCase(),
        capture: 'Y', // Auto-capture (authorize and capture in one step)
        ecomind: 'E', // E-commerce transaction (required for card-not-present)
        // Billing information
        name: metadata.cardholderName || metadata.name,
        email: metadata.email,
        address: metadata.address,
        city: metadata.city,
        region: metadata.region || metadata.state,
        postal: metadata.postal || metadata.zipCode || metadata.zip,
        country: metadata.country || 'US',
        // Optional fields
        invoiceid: metadata.invoiceId,
        orderid: metadata.orderId || this.generateOrderId(),
      };

      // Use token if available (from iframe tokenizer), otherwise use card data
      if (isTokenPayment) {
        // IMPORTANT: CardConnect API expects token in 'account' field
        // The iframe tokenizer returns a token that should be used as the account number
        // When using a token, expiry and CVV are NOT needed
        payload.account = metadata.token;
        // payload.cvv2 = metadata.cvv;
        this.logger.log('Using token-based payment (from iframe tokenizer)');
        this.logger.debug('Token (first 10 chars):', metadata.token.substring(0, 10) + '...');
      } else {
        // Direct card data payment
        payload.account = metadata.cardNumber.replace(/\s/g, '');
        // Expiry format: MMYY (remove slashes if present)
        payload.expiry = metadata.expiry.replace(/\//g, '').replace(/\D/g, '').slice(0, 4);
        // CVV field name is 'cvv2' according to API spec
        payload.cvv2 = metadata.cvv;
        this.logger.log('Using direct card data payment');
      }

      this.logger.debug('CardConnect Request:', {
        merchid: payload.merchid,
        amount: payload.amount,
        account: payload.account ? payload.account.substring(0, 4) + '****' : 'N/A',
        orderid: payload.orderid,
        ecomind: payload.ecomind,
        capture: payload.capture,
      });


      // Ensure API URL doesn't have double slashes
      const apiUrl = this.config.apiUrl.endsWith('/') 
        ? this.config.apiUrl.slice(0, -1) 
        : this.config.apiUrl;
      const endpoint = `${apiUrl}/auth`; // CardConnect auth endpoint

      this.logger.debug('CardConnect API Request:', {
        endpoint,
        merchantid: this.config.mid,
        username: this.config.username,
        hasPassword: !!this.config.password,
      });

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.getAuthHeader(),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let errorText = '';
        try {
          errorText = await response.text();
        } catch (e) {
          errorText = 'Unable to read error response';
        }
        
        this.logger.error(`CardConnect API error: ${response.status}`, {
          status: response.status,
          statusText: response.statusText,
          errorText,
          endpoint,
          merchid: this.config.mid,
          payload: {
            ...payload,
            account: payload.account,
            cvv2: payload.cvv2,
          },
        });
        
        // Try to parse error response as JSON
        let errorMessage = errorText;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorJson.resptext || errorText;
        } catch {
          // Not JSON, use text as-is
        }
        
        throw new Error(`CardConnect API error: ${response.status} - ${errorMessage}`);
      }

      const data: CardConnectResponse = await response.json();

      this.logger.debug('CardConnect Response:', {
        retref: data.retref,
        respstat: data.respstat,
        resptext: data.resptext,
        authcode: data.authcode,
      });

      // Check if payment was approved
      if (data.respstat !== 'A') {
        throw new Error(data.resptext || data.respmsg || 'Payment declined');
      }

      const safeMetadata: Record<string, any> = {
        ...metadata,
        orderId: payload.orderid,
        invoiceId: metadata.invoiceId,
        leadId: metadata.leadId,
        paymentType: metadata.paymentType,
        respstat: data.respstat,
        respcode: data.respcode,
        resptext: data.resptext,
        respmsg: data.respmsg,
        authcode: data.authcode,
        retref: data.retref,
        account: data.account,
        cvvresp: data.cvvresp,
        avsresp: data.avsresp,
      };

      delete safeMetadata.cardNumber;
      delete safeMetadata.cvv;
      delete safeMetadata.expiry;

      return {
        id: data.retref || '',
        provider: PaymentProvider.CARDCONNECT,
        amount: options.amount,
        currency: options.currency || 'usd',
        status: this.mapStatus(data.respstat),
        metadata: safeMetadata,
        createdAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`CardConnect payment failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Get payment details (inquire)
   */
  async getPayment(paymentId: string): Promise<PaymentIntent> {
    try {
      const url = `${this.config.apiUrl}inquire/${paymentId}/${this.config.mid}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': this.getAuthHeader(),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`CardConnect inquire error: ${response.status} - ${errorText}`);
      }

      const data: CardConnectResponse = await response.json();

      return {
        id: data.retref || paymentId,
        provider: PaymentProvider.CARDCONNECT,
        amount: Math.round(parseFloat(data.amount || '0') * 100), // Convert to cents
        currency: 'usd',
        status: this.mapStatus(data.respstat),
        metadata: data,
        createdAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`CardConnect payment retrieval failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Create customer (profile)
   */
  async createCustomer(options: CreateCustomerOptions): Promise<PaymentCustomer> {
    try {
      const payload = {
        merchantid: this.config.mid,
        account: options.metadata?.cardNumber,
        expiry: options.metadata?.expiry,
        name: options.name,
        email: options.email,
        phone: options.phone,
      };

      const response = await fetch(`${this.config.apiUrl}profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.getAuthHeader(),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`CardConnect profile error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      return {
        id: data.profileid,
        provider: PaymentProvider.CARDCONNECT,
        email: options.email,
        name: options.name,
        metadata: {
          acctid: data.acctid,
        },
      };
    } catch (error) {
      this.logger.error(`CardConnect customer creation failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Get customer (profile)
   */
  async getCustomer(customerId: string): Promise<PaymentCustomer> {
    try {
      const url = `${this.config.apiUrl}profile/${customerId}/${this.config.mid}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': this.getAuthHeader(),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`CardConnect profile error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      return {
        id: data.profileid,
        provider: PaymentProvider.CARDCONNECT,
        email: data.email,
        name: data.name,
        metadata: data,
      };
    } catch (error) {
      this.logger.error(`CardConnect customer retrieval failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Refund payment
   */
  async refundPayment(paymentId: string, amount?: number): Promise<RefundResult> {
    try {
      const payload: any = {
        merchantid: this.config.mid,
        retref: paymentId,
      };

      if (amount) {
        payload.amount = (amount / 100).toFixed(2); // Convert to dollars
      }

      const response = await fetch(`${this.config.apiUrl}refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.getAuthHeader(),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`CardConnect refund error: ${response.status} - ${errorText}`);
      }

      const data: CardConnectResponse = await response.json();

      return {
        id: data.retref || '',
        amount: Math.round(parseFloat(data.amount || '0') * 100),
        status: data.respstat === 'A' ? 'succeeded' : 'failed',
        reason: data.resptext,
      };
    } catch (error) {
      this.logger.error(`CardConnect refund failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Void transaction
   */
  async voidTransaction(paymentId: string): Promise<RefundResult> {
    try {
      const payload = {
        merchantid: this.config.mid,
        retref: paymentId,
      };

      const response = await fetch(`${this.config.apiUrl}/void`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.getAuthHeader(),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`CardConnect void error: ${response.status} - ${errorText}`);
      }

      const data: CardConnectResponse = await response.json();

      return {
        id: data.retref || '',
        amount: 0,
        status: data.respstat === 'A' ? 'succeeded' : 'failed',
        reason: data.resptext,
      };
    } catch (error) {
      this.logger.error(`CardConnect void failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Verify webhook (CardConnect doesn't have webhook signature verification)
   */
  async verifyWebhook(payload: any, signature: string): Promise<any> {
    this.logger.log('CardConnect webhook received');
    // CardConnect doesn't provide signature verification
    // You may want to implement IP whitelisting or other security measures
    return payload;
  }

  /**
   * Map CardConnect status to our standard status
   */
  private mapStatus(respstat: string | undefined): PaymentStatus {
    switch (respstat) {
      case 'A':
        return PaymentStatus.SUCCEEDED;
      case 'B':
        return PaymentStatus.PENDING;
      case 'C':
        return PaymentStatus.FAILED;
      default:
        return PaymentStatus.FAILED;
    }
  }

  /**
   * Generate unique order ID
   */
  private generateOrderId(): string {
    return `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}