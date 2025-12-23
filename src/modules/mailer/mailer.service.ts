import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  EmailOptions,
  WelcomeEmailData,
  StaffInvitationData,
  PaymentEmailData,
  EmailLogData,
} from './interfaces/email.interface';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private resend: Resend | null = null;
  private supabase: SupabaseClient | null = null;
  private fromEmail: string;
  private fromName: string;
  private appUrl: string;
  private testModeEmail: string | null; // For development - override recipient to verified email

  constructor(
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    const apiKey = this.configService.get<string>('email.resendApiKey') || this.configService.get<string>('RESEND_API_KEY');
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not configured. Email sending will be disabled.');
    } else {
      this.resend = new Resend(apiKey);
    }

    // Initialize Supabase for email logging and preference checking
    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
      this.logger.log('Supabase client initialized for email logging');
    } else {
      this.logger.warn('Supabase not configured. Email logging will be disabled.');
    }

    // Use verified Resend subdomain: notifications@notifications.mypreschoolpro.com
    // Subdomain notifications.mypreschoolpro.com is verified in Resend (DKIM, SPF, MX all green)
    // API Key: re_LHtzYsTS_LhDv5UP2KkeRZF7ub998qhNB
    // Production: notifications@notifications.mypreschoolpro.com (verified subdomain)
    // Development/Test: onboarding@resend.dev (Resend test domain)
    this.fromEmail = this.configService.get<string>('email.fromEmail') || 
                     this.configService.get<string>('EMAIL_FROM') || 
                     'notifications@notifications.mypreschoolpro.com';
    this.fromName = this.configService.get<string>('email.fromName') || 
                    this.configService.get<string>('EMAIL_FROM_NAME') || 
                    'MyPreschoolPro';
    this.appUrl = this.configService.get<string>('app.frontendUrl') || this.configService.get<string>('APP_URL', 'http://localhost:5173');
    
    // Development mode: Override recipient email for testing (only works with Resend test domains)
    // Set EMAIL_TEST_RECIPIENT to your verified email (e.g., jahanzaibimrandev@gmail.com)
    // This allows testing without domain verification
    this.testModeEmail = this.configService.get<string>('EMAIL_TEST_RECIPIENT') || 
                         this.configService.get<string>('email.testRecipient') ||
                         'jahanzaibimrandev@gmail.com'; // Default test email
    
    if (this.testModeEmail) {
      this.logger.warn(`⚠️  EMAIL TEST MODE: All emails will be sent to ${this.testModeEmail} instead of actual recipients`);
    }
    
    this.logger.log(`Mailer service initialized with sender: ${this.fromName} <${this.fromEmail}>`);
  }

  /**
   * Generic email sender with preference checking and logging
   */
  async sendEmail(
    options: EmailOptions,
  ): Promise<{ success: boolean; emailId?: string; skipped?: boolean; reason?: string; error?: string }> {
    try {
      let recipientEmail = Array.isArray(options.to) ? options.to[0] : options.to;
      
      // Development mode: Override recipient if test mode is enabled
      // This allows testing with Resend test domains without domain verification
      if (this.testModeEmail) {
        const originalRecipient = recipientEmail;
        recipientEmail = this.testModeEmail;
        this.logger.warn(`📧 TEST MODE: Redirecting email from ${originalRecipient} to ${this.testModeEmail}`);
        
        // Add note in email subject/body about test mode
        if (options.subject && !options.subject.includes('[TEST]')) {
          options.subject = `[TEST] ${options.subject} (Original: ${originalRecipient})`;
        }
      }

      // Check user email preferences if userId provided
      if (options.userId && this.supabase) {
        const preference = await this.checkUserEmailPreference(
          options.userId,
          options.schoolId,
          options.emailType || 'system_alert',
        );

        if (preference === false) {
          this.logger.log(`User ${options.userId} has disabled ${options.emailType} emails`);

          // Log as skipped
          await this.logEmail({
            recipient_email: recipientEmail,
            email_type: options.emailType || 'system_alert',
            subject: options.subject,
            status: 'skipped',
            user_id: options.userId,
            school_id: options.schoolId,
            metadata: { ...options.metadata, skipped: true, reason: 'user_preference' },
            sent_at: new Date().toISOString(),
          });

          return { success: true, skipped: true, reason: 'User preference disabled' };
        }
      }

      // Log email attempt
      const emailLogId = await this.logEmail({
        recipient_email: recipientEmail,
        email_type: options.emailType || 'system_alert',
        subject: options.subject,
        status: 'pending',
        user_id: options.userId,
        school_id: options.schoolId,
        metadata: options.metadata,
      });

      if (!this.resend) {
        throw new Error('Email service not configured');
      }

      // Check if we're in test mode (Resend test API key)
      // In test mode, Resend only allows sending to verified test emails
      const isTestMode = this.configService.get<string>('RESEND_API_KEY')?.startsWith('re_test_') || 
                        this.configService.get<string>('email.resendApiKey')?.startsWith('re_test_');
      
      // Get allowed test emails from env (comma-separated)
      const allowedTestEmails = this.configService.get<string>('RESEND_TEST_EMAILS')?.split(',').map(e => e.trim()) || 
                                ['colleen@mypreschoolpro.com']; // Default test email
      
      // In test mode, validate recipient
      if (isTestMode) {
        const recipientEmail = Array.isArray(options.to) ? options.to[0] : options.to;
        const isAllowed = allowedTestEmails.some(email => 
          recipientEmail.toLowerCase() === email.toLowerCase()
        );
        
        if (!isAllowed) {
          const errorMsg = `Resend is in test mode. You can only send emails to verified test addresses: ${allowedTestEmails.join(', ')}. To send to other recipients, verify a domain at resend.com/domains`;
          this.logger.warn(errorMsg);
          throw new Error(errorMsg);
        }
        
        this.logger.log(`Test mode: Sending email to verified test address: ${recipientEmail}`);
      }

      // Build email payload
      // Use test mode recipient if enabled, otherwise use original recipient(s)
      const finalRecipients = this.testModeEmail 
        ? [this.testModeEmail]
        : (Array.isArray(options.to) ? options.to : [options.to]);
      
      // Ensure from field is always a valid string (never null or empty)
      let fromEmail: string;
      if (options.from && options.from !== null && options.from.trim() !== '') {
        fromEmail = options.from;
      } else {
        // Use default format: "Name <email@domain.com>"
        if (this.fromName && this.fromEmail) {
          fromEmail = `${this.fromName} <${this.fromEmail}>`;
        } else if (this.fromEmail) {
          // Fallback to just email if name is missing
          fromEmail = this.fromEmail;
        } else {
          // Last resort fallback - should never happen if service initialized correctly
          fromEmail = 'notifications@notifications.mypreschoolpro.com';
          this.logger.warn('⚠️  Using fallback from email address - service may not be initialized correctly');
        }
      }
      
      // Validate that fromEmail is not null or empty before sending
      if (!fromEmail || fromEmail.trim() === '') {
        throw new Error('Invalid from email address: cannot be null or empty');
      }
      
      const emailPayload = {
        from: fromEmail,
        to: finalRecipients,
        subject: options.subject,
        html: options.html || undefined,
        text: options.text || undefined,
        reply_to: options.replyTo || undefined,
        cc: options.cc || undefined,
        bcc: options.bcc || undefined,
      } as any;
      
      this.logger.debug(`Sending email from: ${fromEmail}, to: ${finalRecipients.join(', ')}, subject: ${options.subject}`);

      // Send email via Resend
      if (!this.resend) {
        throw new Error('Email service not configured');
      }
      const emailResponse = await this.resend.emails.send(emailPayload);

      if (emailResponse.error) {
        throw new Error(emailResponse.error.message);
      }

      this.logger.log(`Email sent successfully: ${emailResponse.data?.id}`);

      // Update email log with success
      if (emailLogId) {
        await this.updateEmailLog(emailLogId, {
          status: 'sent',
          sent_at: new Date().toISOString(),
          metadata: { ...options.metadata, resend_id: emailResponse.data?.id },
        });
      }

      return { success: true, emailId: emailResponse.data?.id };
    } catch (error) {
      this.logger.error(`Email send failed: ${error.message}`, error.stack);

      // Log failure
      await this.logEmail({
        recipient_email: Array.isArray(options.to) ? options.to[0] : options.to,
        email_type: options.emailType || 'system_alert',
        subject: options.subject || 'Unknown',
        status: 'failed',
        error_message: error.message,
        user_id: options.userId,
        school_id: options.schoolId,
        metadata: options.metadata,
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Send welcome email by role
   */
  async sendWelcomeEmail(data: WelcomeEmailData): Promise<{ success: boolean; emailId?: string }> {
    this.logger.log(`Sending welcome email to ${data.userEmail} (role: ${data.userRole})`);

    const html = this.getWelcomeEmailHTML(data);
    const subject = `Welcome to MyPreschoolPro${data.schoolName ? ` - ${data.schoolName}` : ''}!`;

    return this.sendEmail({
      to: data.userEmail,
      subject,
      html,
      emailType: 'welcome',
      userId: data.userEmail, // Use email as identifier if no userId
      schoolId: data.schoolId,
      metadata: {
        userRole: data.userRole,
        schoolName: data.schoolName,
      },
    });
  }

  /**
   * Send staff invitation
   */
  async sendStaffInvitation(
    data: StaffInvitationData,
  ): Promise<{ success: boolean; emailId?: string; skipped?: boolean; reason?: string; error?: string }> {
    this.logger.log(`Sending staff invitation to ${data.email} (role: ${data.role})`);

    const roleName = data.role.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase());
    const html = this.getStaffInvitationHTML(data, roleName);
    const subject = `Staff Invitation - Join ${data.schoolName}`;

    return this.sendEmail({
      to: data.email,
      subject,
      html,
      emailType: 'staff_invitation',
      schoolId: data.schoolId,
      metadata: {
        role: data.role,
        invitationToken: data.invitationToken,
      },
    });
  }

  /**
   * Send payment email
   */
  async sendPaymentEmail(
    data: PaymentEmailData,
  ): Promise<{ success: boolean; emailId?: string }> {
    this.logger.log(`Sending payment email (${data.type}) to ${data.recipientEmail}`);

    const html = this.getPaymentEmailHTML(data);
    const subject = this.getPaymentEmailSubject(data);

    const emailTypeMap = {
      invoice: 'payment_invoice',
      confirmation: 'payment_confirmation',
      reminder: 'payment_reminder',
      failure: 'payment_failure',
    };

    return this.sendEmail({
      to: data.recipientEmail,
      subject,
      html,
      emailType: emailTypeMap[data.type],
      userId: data.userId,
      schoolId: data.schoolId,
      metadata: {
        paymentType: data.type,
        amount: data.amount,
        currency: data.currency,
        invoiceNumber: data.invoiceNumber,
        dueDate: data.dueDate,
        paymentDate: data.paymentDate,
        ...data.metadata,
      },
    });
  }

  /**
   * Send bulk emails (rate-limited)
   */
  async sendBulkEmails(
    recipients: string[],
    subject: string,
    html: string,
    emailType: string,
  ): Promise<{ success: boolean; sent: number; failed: number }> {
    this.logger.log(`Sending bulk email to ${recipients.length} recipients`);

    let sent = 0;
    let failed = 0;

    // Send in batches of 50 (Resend limit)
    const batchSize = 50;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map((to) => this.sendEmail({ to, subject, html, emailType })),
      );

      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.success) {
          sent++;
        } else {
          failed++;
        }
      });

      // Rate limiting - wait 1 second between batches
      if (i + batchSize < recipients.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    this.logger.log(`Bulk email complete: ${sent} sent, ${failed} failed`);
    return { success: true, sent, failed };
  }

  /**
   * Check user email preference (cached)
   */
  private async checkUserEmailPreference(
    userId: string,
    schoolId: string | undefined,
    emailType: string,
  ): Promise<boolean | null> {
    try {
      if (!this.supabase) {
        return null; // Default to allowing email if Supabase not configured
      }

      // Check cache first
      const cacheKey = `email_pref:${userId}:${schoolId || 'global'}:${emailType}`;
      const cached = await this.cacheManager.get<boolean | null>(cacheKey);

      if (cached !== undefined) {
        return cached;
      }

      // Call Supabase RPC function
      if (!this.supabase) {
        return null; // Default to allowing email if Supabase not configured
      }
      const { data, error } = await this.supabase.rpc('get_user_email_preference', {
        user_uuid: userId,
        school_uuid: schoolId || null,
        email_type_param: emailType,
      });

      if (error) {
        this.logger.warn(`Failed to check email preference: ${error.message}`);
        return null; // Default to allowing email if check fails
      }

      // Cache for 5 minutes
      await this.cacheManager.set(cacheKey, data, 300000);

      return data;
    } catch (error) {
      this.logger.warn(`Email preference check error: ${error.message}`);
      return null;
    }
  }

  /**
   * Log email to database
   */
  private async logEmail(data: EmailLogData): Promise<string | null> {
    try {
      if (!this.supabase) {
        return null;
      }

      const { data: emailLog, error } = await this.supabase
        .from('email_logs')
        .insert({
          recipient_email: data.recipient_email,
          email_type: data.email_type,
          subject: data.subject,
          status: data.status,
          user_id: data.user_id,
          school_id: data.school_id,
          metadata: data.metadata,
          error_message: data.error_message,
          sent_at: data.sent_at,
        })
        .select('id')
        .single();

      if (error) {
        this.logger.error(`Error logging email: ${error.message}`);
        return null;
      }

      return emailLog?.id || null;
    } catch (error) {
      this.logger.error(`Email log error: ${error.message}`);
      return null;
    }
  }

  /**
   * Update email log
   */
  private async updateEmailLog(
    emailLogId: string | null,
    updates: {
      status?: string;
      sent_at?: string;
      error_message?: string;
      metadata?: Record<string, any>;
    },
  ): Promise<void> {
    if (!emailLogId || !this.supabase) return;

    try {
      await this.supabase.from('email_logs').update(updates).eq('id', emailLogId);
    } catch (error) {
      this.logger.error(`Error updating email log: ${error.message}`);
    }
  }

  /**
   * Get welcome email HTML by role
   */
  private getWelcomeEmailHTML(data: WelcomeEmailData): string {
    const baseUrl = this.appUrl;

    switch (data.userRole) {
      case 'parent':
        return `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0;">🎉 Welcome to MyPreschoolPro!</h1>
            </div>
            <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
              <h2 style="color: #333;">Hi ${data.userName}! 👋</h2>
              <p style="color: #666; line-height: 1.6;"><strong>Great news!</strong> Your child has been successfully added to the waitlist at ${data.schoolName || 'our school'}. We've created a parent account for you to track your child's application progress.</p>
              
              <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
                <h3 style="color: #1e40af; margin-top: 0;">📋 Your Parent Dashboard</h3>
                <p style="color: #666;">With your new account, you can:</p>
                <ul style="margin: 10px 0; color: #666;">
                  <li><strong>Track waitlist position</strong> - See where your child stands in line</li>
                  <li><strong>View application status</strong> - Get real-time updates on your child's progress</li>
                  <li><strong>Receive important notifications</strong> - Stay informed about enrollment updates</li>
                  <li><strong>Manage payments</strong> - Handle registration fees and tuition when ready</li>
                  <li><strong>Access school communications</strong> - Get updates directly from school staff</li>
                </ul>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${baseUrl}/login" style="background-color: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                  🔐 Login to Track Your Child's Status
                </a>
              </div>
              
              <div style="background-color: #fef3c7; padding: 15px; border-radius: 6px; border-left: 4px solid #f59e0b; margin: 20px 0;">
                <p style="margin: 0; color: #92400e;"><strong>💡 Next Steps:</strong> Log in to your parent dashboard to view your child's current waitlist position and get updates on the enrollment process.</p>
              </div>
              
              <p style="color: #666;">If you have any questions about the enrollment process or need help accessing your account, please don't hesitate to contact the school administration.</p>
              <p style="color: #666;">Best regards,<br>The MyPreschoolPro Team</p>
            </div>
          </div>
        `;

      case 'school_admin':
      case 'admissions_staff':
        return `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #2563eb;">Welcome to MyPreschoolPro!</h1>
            <p>Dear ${data.userName},</p>
            <p>Welcome to MyPreschoolPro! You've been added as ${data.userRole.replace('_', ' ')} for ${data.schoolName || 'your school'}.</p>
            <p>As a ${data.userRole.replace('_', ' ')}, you can:</p>
            <ul>
              <li>Manage student enrollments and waitlists</li>
              <li>Track payments and invoices</li>
              <li>Communicate with parents and staff</li>
              <li>View comprehensive analytics and reports</li>
            </ul>
            <p>
              <a href="${baseUrl}/login" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Access Your Dashboard
              </a>
            </p>
            <p>Best regards,<br>The MyPreschoolPro Team</p>
          </div>
        `;

      case 'teacher':
        return `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #2563eb;">Welcome to MyPreschoolPro!</h1>
            <p>Dear ${data.userName},</p>
            <p>Welcome to MyPreschoolPro! You've been added as a teacher for ${data.schoolName || 'your school'}.</p>
            <p>As a teacher, you can:</p>
            <ul>
              <li>Manage your class roster and student progress</li>
              <li>Create and update lesson plans</li>
              <li>Communicate with parents about student activities</li>
              <li>Track student attendance and performance</li>
            </ul>
            <p>
              <a href="${baseUrl}/login" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Access Your Dashboard
              </a>
            </p>
            <p>Best regards,<br>The MyPreschoolPro Team</p>
          </div>
        `;

      case 'school_owner':
        return `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #2563eb;">Welcome to MyPreschoolPro!</h1>
            <p>Dear ${data.userName},</p>
            <p>Welcome to MyPreschoolPro! Your school ${data.schoolName || 'account'} has been set up successfully.</p>
            <p>As a school owner, you have access to:</p>
            <ul>
              <li>Complete school management dashboard</li>
              <li>Financial overview and payment tracking</li>
              <li>Staff and user management</li>
              <li>Advanced analytics and reporting</li>
              <li>System configuration and settings</li>
            </ul>
            <p>
              <a href="${baseUrl}/login" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Access Your Dashboard
              </a>
            </p>
            <p>Best regards,<br>The MyPreschoolPro Team</p>
          </div>
        `;

      default:
        return `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #2563eb;">Welcome to MyPreschoolPro!</h1>
            <p>Dear ${data.userName},</p>
            <p>Welcome to MyPreschoolPro! Your account has been created successfully.</p>
            <p>
              <a href="${baseUrl}/login" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Login to Your Account
              </a>
            </p>
            <p>Best regards,<br>The MyPreschoolPro Team</p>
          </div>
        `;
    }
  }

  /**
   * Get staff invitation HTML
   */
  private getStaffInvitationHTML(data: StaffInvitationData, roleName: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #f8fafc; padding: 30px; border-radius: 8px;">
          <h1 style="color: #1f2937; margin-bottom: 20px;">You're Invited to Join ${data.schoolName}!</h1>
          
          <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
            Hi there,
          </p>
          
          <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
            ${data.invitedBy} has invited you to join <strong>${data.schoolName}</strong> as a <strong>${roleName}</strong> on MyPreschoolPro.
          </p>
          
          <div style="background-color: #ffffff; padding: 20px; border-radius: 6px; margin: 25px 0; border-left: 4px solid #3b82f6;">
            <h3 style="color: #1f2937; margin-top: 0;">Invitation Details:</h3>
            <p style="color: #4b5563; margin: 5px 0;"><strong>School:</strong> ${data.schoolName}</p>
            <p style="color: #4b5563; margin: 5px 0;"><strong>Role:</strong> ${roleName}</p>
            <p style="color: #4b5563; margin: 5px 0;"><strong>Invited by:</strong> ${data.invitedBy}</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.invitationLink}" 
               style="background-color: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Accept Invitation
            </a>
          </div>
          
          <p style="color: #6b7280; font-size: 14px; line-height: 1.5;">
            This invitation will expire in 7 days. If you don't have an account yet, you'll be prompted to create one when you click the invitation link.
          </p>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;">
          
          <p style="color: #9ca3af; font-size: 12px;">
            If you're having trouble with the button above, copy and paste this link into your browser:
            <br>
            <a href="${data.invitationLink}" style="color: #3b82f6; word-break: break-all;">${data.invitationLink}</a>
          </p>
          
          <p style="color: #9ca3af; font-size: 12px;">
            If you didn't expect this invitation, you can safely ignore this email.
          </p>
        </div>
      </div>
    `;
  }

  /**
   * Get payment email HTML
   */
  private getPaymentEmailHTML(data: PaymentEmailData): string {
    const baseUrl = this.appUrl;
    const formatAmount = (amount: number, currency: string) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency.toUpperCase(),
      }).format(amount / 100);
    };

    switch (data.type) {
      case 'invoice':
        return `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #2563eb;">Invoice from ${data.schoolName}</h1>
            <p>Dear ${data.recipientName},</p>
            <p>You have received a new invoice from ${data.schoolName}.</p>
            
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Invoice Details</h3>
              ${data.invoiceNumber ? `<p><strong>Invoice Number:</strong> ${data.invoiceNumber}</p>` : ''}
              <p><strong>Amount Due:</strong> ${formatAmount(data.amount, data.currency || 'USD')}</p>
              ${data.dueDate ? `<p><strong>Due Date:</strong> ${new Date(data.dueDate).toLocaleDateString()}</p>` : ''}
            </div>

            ${data.paymentUrl ? `
              <p>
                <a href="${data.paymentUrl}" style="background-color: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                  Pay Now
                </a>
              </p>
            ` : ''}

            <p>You can also view and manage your payments in your account:</p>
            <p>
              <a href="${baseUrl}/parent/payments" style="color: #2563eb; text-decoration: none;">
                View Payment History
              </a>
            </p>

            <p>If you have any questions about this invoice, please contact ${data.schoolName} directly.</p>
            <p>Best regards,<br>${data.schoolName}</p>
          </div>
        `;

      case 'confirmation':
        return `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #16a34a;">Payment Confirmation</h1>
            <p>Dear ${data.recipientName},</p>
            <p>Thank you! Your payment to ${data.schoolName} has been processed successfully.</p>
            
            <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #16a34a;">Payment Details</h3>
              ${data.invoiceNumber ? `<p><strong>Invoice Number:</strong> ${data.invoiceNumber}</p>` : ''}
              <p><strong>Amount Paid:</strong> ${formatAmount(data.amount, data.currency || 'USD')}</p>
              ${data.paymentDate ? `<p><strong>Payment Date:</strong> ${new Date(data.paymentDate).toLocaleDateString()}</p>` : ''}
            </div>

            <p>You can view your receipt and payment history in your account:</p>
            <p>
              <a href="${baseUrl}/parent/payments" style="color: #2563eb; text-decoration: none;">
                View Payment History
              </a>
            </p>

            <p>Thank you for your payment!</p>
            <p>Best regards,<br>${data.schoolName}</p>
          </div>
        `;

      case 'reminder':
        return `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #ea580c;">Payment Reminder</h1>
            <p>Dear ${data.recipientName},</p>
            <p>This is a friendly reminder that you have an outstanding payment with ${data.schoolName}.</p>
            
            <div style="background-color: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #ea580c;">Payment Details</h3>
              ${data.invoiceNumber ? `<p><strong>Invoice Number:</strong> ${data.invoiceNumber}</p>` : ''}
              <p><strong>Amount Due:</strong> ${formatAmount(data.amount, data.currency || 'USD')}</p>
              ${data.dueDate ? `<p><strong>Due Date:</strong> ${new Date(data.dueDate).toLocaleDateString()}</p>` : ''}
            </div>

            ${data.paymentUrl ? `
              <p>Please make your payment as soon as possible:</p>
              <p>
                <a href="${data.paymentUrl}" style="background-color: #ea580c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                  Pay Now
                </a>
              </p>
            ` : ''}

            <p>You can also view and manage your payments in your account:</p>
            <p>
              <a href="${baseUrl}/parent/payments" style="color: #2563eb; text-decoration: none;">
                View Payment History
              </a>
            </p>

            <p>If you have any questions, please contact ${data.schoolName} directly.</p>
            <p>Best regards,<br>${data.schoolName}</p>
          </div>
        `;

      case 'failure':
        return `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #dc2626;">Payment Failed</h1>
            <p>Dear ${data.recipientName},</p>
            <p>We were unable to process your payment to ${data.schoolName}. Please check your payment method and try again.</p>
            
            <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #dc2626;">Payment Details</h3>
              ${data.invoiceNumber ? `<p><strong>Invoice Number:</strong> ${data.invoiceNumber}</p>` : ''}
              <p><strong>Amount:</strong> ${formatAmount(data.amount, data.currency || 'USD')}</p>
              ${data.dueDate ? `<p><strong>Due Date:</strong> ${new Date(data.dueDate).toLocaleDateString()}</p>` : ''}
            </div>

            ${data.paymentUrl ? `
              <p>Please try your payment again:</p>
              <p>
                <a href="${data.paymentUrl}" style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                  Retry Payment
                </a>
              </p>
            ` : ''}

            <p>If you continue to experience issues, please contact ${data.schoolName} directly.</p>
            <p>Best regards,<br>${data.schoolName}</p>
          </div>
        `;

      default:
        throw new Error(`Unknown payment email type: ${data.type}`);
    }
  }

  /**
   * Get payment email subject
   */
  private getPaymentEmailSubject(data: PaymentEmailData): string {
    switch (data.type) {
      case 'invoice':
        return `Invoice from ${data.schoolName}${data.invoiceNumber ? ` - ${data.invoiceNumber}` : ''}`;
      case 'confirmation':
        return `Payment Confirmation - ${data.schoolName}`;
      case 'reminder':
        return `Payment Reminder - ${data.schoolName}`;
      case 'failure':
        return `Payment Failed - ${data.schoolName}`;
      default:
        return `Payment Notification - ${data.schoolName}`;
    }
  }
}
