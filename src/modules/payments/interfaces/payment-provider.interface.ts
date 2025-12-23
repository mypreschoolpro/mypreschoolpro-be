import { PaymentIntent, PaymentCustomer, RefundResult } from './payment.interface';

export interface CreatePaymentOptions {
  amount: number;
  currency?: string;
  customerId?: string;
  metadata?: Record<string, any>;
  description?: string;
}

export interface CreateCustomerOptions {
  email: string;
  name: string;
  phone?: string;
  metadata?: Record<string, any>;
}

export interface IPaymentProvider {
  /**
   * Create a payment intent
   */
  createPayment(options: CreatePaymentOptions): Promise<PaymentIntent>;

  /**
   * Retrieve payment details
   */
  getPayment(paymentId: string): Promise<PaymentIntent>;

  /**
   * Create a customer
   */
  createCustomer(options: CreateCustomerOptions): Promise<PaymentCustomer>;

  /**
   * Get customer details
   */
  getCustomer(customerId: string): Promise<PaymentCustomer>;

  /**
   * Refund a payment
   */
  refundPayment(paymentId: string, amount?: number): Promise<RefundResult>;

  /**
   * Void a transaction (cancel before settlement)
   */
  voidTransaction?(paymentId: string): Promise<RefundResult>;

  /**
   * Verify webhook signature and parse event
   */
  verifyWebhook(payload: any, signature: string): Promise<any>;
}