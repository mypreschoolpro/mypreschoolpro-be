import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import type { Express } from 'express';
import { SchoolEntity, SchoolStatus } from '../schools/entities/school.entity';
import { LeadEntity } from '../leads/entities/lead.entity';
import { Waitlist } from '../enrollment/entities/waitlist.entity';
import { Transaction } from '../payments/entities/transaction.entity';
import { PublicSchoolDto } from './dto/public-school.dto';
import { AvailabilityResponseDto } from './dto/check-availability.dto';
import { WaitlistPaymentSessionDto, WaitlistPaymentResponseDto } from './dto/waitlist-payment.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { LeadStatusType } from '../../common/enums/lead-status-type.enum';
import {
  StudentDocument,
  DocumentStatus,
  DocumentCategory,
} from '../students/entities/student-document.entity';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

@Injectable()
export class ParentRegistrationService {
  private readonly logger = new Logger(ParentRegistrationService.name);
  private readonly stripe: Stripe | null;
  private readonly frontendUrl: string;
  private readonly s3: S3Client | null;
  private readonly s3Bucket: string | null;
  private readonly s3Region: string | null;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(SchoolEntity)
    private readonly schoolsRepository: Repository<SchoolEntity>,
    @InjectRepository(LeadEntity)
    private readonly leadsRepository: Repository<LeadEntity>,
    @InjectRepository(Waitlist)
    private readonly waitlistRepository: Repository<Waitlist>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(StudentDocument)
    private readonly studentDocumentRepository: Repository<StudentDocument>,
  ) {
    const stripeSecret =
      this.configService.get<string>('payments.stripeSecretKey') ||
      this.configService.get<string>('STRIPE_SECRET_KEY');
    this.stripe = stripeSecret
      ? new Stripe(stripeSecret, { apiVersion: '2023-10-16' as Stripe.LatestApiVersion })
      : null;

    this.frontendUrl =
      this.configService.get<string>('app.frontendUrl') ||
      this.configService.get<string>('APP_URL', 'http://localhost:5173');

    const accessKeyId =
      this.configService.get<string>('AWS_ACCESS_KEY_ID') ||
      this.configService.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey =
      this.configService.get<string>('AWS_SECRET_ACCESS_KEY') ||
      this.configService.get<string>('S3_SECRET_ACCESS_KEY');
    this.s3Region =
      this.configService.get<string>('AWS_REGION') ||
      this.configService.get<string>('S3_REGION') ||
      null;
    this.s3Bucket =
      this.configService.get<string>('PARENT_DOCUMENTS_BUCKET') ||
      this.configService.get<string>('AWS_S3_BUCKET') ||
      null;

    if (accessKeyId && secretAccessKey && this.s3Region && this.s3Bucket) {
      this.s3 = new S3Client({
        region: this.s3Region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      this.logger.log(`S3 client initialized for bucket ${this.s3Bucket}`);
    } else {
      this.s3 = null;
      this.logger.warn('S3 not fully configured; document uploads will be disabled.');
    }
  }

  async getPublicSchools(): Promise<PublicSchoolDto[]> {
    const schools = await this.schoolsRepository.find({
      where: { status: SchoolStatus.ACTIVE },
      select: ['id', 'name', 'programsOffered', 'capacity', 'address', 'phone', 'email'],
      order: { name: 'ASC' },
    });

    return schools.map((school) => ({
      id: school.id,
      name: school.name,
      programsOffered: school.programsOffered || [],
      capacity: school.capacity ?? 0,
      address: school.address,
      phone: school.phone,
      email: school.email,
    }));
  }

  async checkAvailability(schoolId: string, program: string): Promise<AvailabilityResponseDto> {
    const school = await this.schoolsRepository.findOne({ where: { id: schoolId } });
    if (!school) {
      throw new NotFoundException('School not found');
    }

    const normalizedProgram = program.trim().toLowerCase();
    const programCount = (school.programsOffered?.length || 1) || 1;
    const programCapacity = Math.max(1, Math.floor((school.capacity || 100) / programCount));

    const enrolledStatuses = [
      'converted',
      'enrolled',
      'confirmed',
      'approved_for_registration',
      'invoice_sent',
    ];

    const enrolledCount = await this.leadsRepository
      .createQueryBuilder('lead')
      .where('lead.school_id = :schoolId', { schoolId })
      .andWhere('LOWER(lead.program) = :program', { program: normalizedProgram })
      .andWhere('LOWER(lead.lead_status) IN (:...statuses)', {
        statuses: enrolledStatuses,
      })
      .getCount();

    const waitlistStatuses = ['waitlisted', 'new'];
    const waitlistCount = await this.waitlistRepository
      .createQueryBuilder('waitlist')
      .where('waitlist.school_id = :schoolId', { schoolId })
      .andWhere('LOWER(waitlist.program) = :program', { program: normalizedProgram })
      .andWhere('LOWER(waitlist.status) IN (:...statuses)', { statuses: waitlistStatuses })
      .getCount();

    const availableSeats = Math.max(programCapacity - enrolledCount, 0);

    return {
      programCapacity,
      enrolledCount,
      waitlistCount,
      availableSeats,
      hasAvailability: availableSeats > 0,
    };
  }

  async createWaitlistEntry(dto: CreateWaitlistEntryDto) {
    const existing = await this.waitlistRepository.findOne({
      where: { leadId: dto.leadId },
    });

    if (existing) {
      return existing;
    }

    const currentPosition = await this.waitlistRepository.count({
      where: {
        schoolId: dto.schoolId,
        program: dto.program,
      },
    });

    const entry = this.waitlistRepository.create({
      leadId: dto.leadId,
      schoolId: dto.schoolId,
      program: dto.program,
      waitlistPosition: currentPosition + 1,
      priorityScore: 0,
      status: LeadStatusType.WAITLISTED,
    });

    return this.waitlistRepository.save(entry);
  }

  async createWaitlistPaymentSession(
    dto: WaitlistPaymentSessionDto,
  ): Promise<WaitlistPaymentResponseDto> {
    // Verify lead exists
    const lead = await this.leadsRepository.findOne({
      where: { id: dto.leadId },
      select: ['id', 'parentEmail'],
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    // Create pending transaction record for CardConnect payment
    // The actual payment will be processed via /payments/process-cardconnect endpoint
    const transaction = this.transactionRepository.create({
      userId: null,
      schoolId: dto.schoolId,
      amount: dto.amount,
      currency: dto.currency,
      status: PaymentStatus.PENDING,
      paymentType: dto.paymentType,
      description: dto.description,
      metadata: {
        leadId: dto.leadId,
        schoolId: dto.schoolId,
      },
    });

    await this.transactionRepository.save(transaction);

    // Return empty URL - frontend will handle CardConnect payment form inline
    // The transaction ID can be used to track the payment
    return { url: '' };
  }

  async uploadDocument(dto: UploadDocumentDto, file: Express.Multer.File, user?: AuthUser) {
    if (!this.s3 || !this.s3Bucket || !this.s3Region) {
      throw new BadRequestException('Document storage is not configured');
    }

    if (!file) {
      throw new BadRequestException('File is required');
    }

    const fileExt = file.originalname.split('.').pop();
    const objectKey = `${dto.leadId}/${dto.documentType}_${Date.now()}_${randomUUID()}.${fileExt}`;
    const fileUrl = `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${objectKey}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key: objectKey,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    const category = ['enrollment_packet', 'shot_records', 'physical_records'].includes(dto.documentType)
      ? DocumentCategory.REQUIRED
      : DocumentCategory.OPTIONAL;

    const document = this.studentDocumentRepository.create({
      studentId: dto.leadId,
      schoolId: dto.schoolId,
      documentType: dto.documentType,
      category,
      fileName: file.originalname,
      filePath: objectKey,
      fileUrl,
      storageProvider: 's3',
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedBy: user?.id ?? dto.leadId,
      uploadDate: new Date(),
      status: DocumentStatus.PENDING,
      notes: null,
    });

    const savedDocument = await this.studentDocumentRepository.save(document);

    return {
      success: true,
      documentId: savedDocument.id,
      fileUrl,
    };
  }

  /**
   * Public document upload for intake forms (no authentication required)
   * Validates that the lead exists and belongs to the school
   */
  async uploadPublicDocument(dto: UploadDocumentDto, file: Express.Multer.File) {
    if (!this.s3 || !this.s3Bucket || !this.s3Region) {
      throw new BadRequestException('Document storage is not configured');
    }

    if (!file) {
      throw new BadRequestException('File is required');
    }

    // Validate that the lead exists and belongs to the school
    const lead = await this.leadsRepository.findOne({
      where: { id: dto.leadId, schoolId: dto.schoolId },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found or does not belong to the specified school');
    }

    // Validate file type
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'image/jpeg',
      'image/jpg',
      'image/png',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only PDF, DOC, DOCX, JPG, and PNG files are allowed.',
      );
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new BadRequestException('File size exceeds 10MB limit');
    }

    const fileExt = file.originalname.split('.').pop();
    const objectKey = `public-intake/${dto.leadId}/${dto.documentType}_${Date.now()}_${randomUUID()}.${fileExt}`;
    const fileUrl = `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${objectKey}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key: objectKey,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    const category = ['enrollment_packet', 'shot_records', 'physical_records'].includes(
      dto.documentType,
    )
      ? DocumentCategory.REQUIRED
      : DocumentCategory.OPTIONAL;

    const document = this.studentDocumentRepository.create({
      studentId: dto.leadId,
      schoolId: dto.schoolId,
      documentType: dto.documentType,
      category,
      fileName: file.originalname,
      filePath: objectKey,
      fileUrl,
      storageProvider: 's3',
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedBy: dto.leadId, // Use leadId as uploadedBy for public uploads
      uploadDate: new Date(),
      status: DocumentStatus.PENDING,
      notes: 'Uploaded via public intake form',
    });

    const savedDocument = await this.studentDocumentRepository.save(document);

    this.logger.log(
      `Public document uploaded: ${savedDocument.id} for lead ${dto.leadId} at school ${dto.schoolId}`,
    );

    return {
      success: true,
      documentId: savedDocument.id,
      fileUrl,
      documentType: dto.documentType,
    };
  }
}


