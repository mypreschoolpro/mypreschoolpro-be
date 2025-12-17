import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailConfiguration } from './entities/email-configuration.entity';
import { CreateEmailConfigurationDto } from './dto/create-email-configuration.dto';
import { UpdateEmailConfigurationDto } from './dto/update-email-configuration.dto';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { AppRole } from '../../common/enums/app-role.enum';
import { SchoolEntity } from '../schools/entities/school.entity';

@Injectable()
export class EmailConfigurationService {
  private readonly logger = new Logger(EmailConfigurationService.name);

  constructor(
    @InjectRepository(EmailConfiguration)
    private readonly emailConfigurationRepository: Repository<EmailConfiguration>,
    @InjectRepository(SchoolEntity)
    private readonly schoolRepository: Repository<SchoolEntity>,
  ) {}

  /**
   * Get all email configurations (optionally filtered by school)
   */
  async findAll(schoolId?: string, user?: AuthUser): Promise<EmailConfiguration[]> {
    const query = this.emailConfigurationRepository.createQueryBuilder('config');

    if (schoolId) {
      if (user) {
        await this.ensureUserHasAccessToSchool(user, schoolId);
      }
      query.where('config.schoolId = :schoolId', { schoolId });
    } else if (user && user.primaryRole !== AppRole.SUPER_ADMIN) {
      // Non-super admins can only see their own school's configs
      const accessibleSchoolIds = new Set<string>();
      if (user.schoolId) {
        accessibleSchoolIds.add(user.schoolId);
      }
      user.roles?.forEach((role) => {
        if (role.schoolId) {
          accessibleSchoolIds.add(role.schoolId);
        }
      });
      if (user.primaryRole === AppRole.SCHOOL_OWNER) {
        const ownedSchools = await this.schoolRepository.find({
          where: { ownerId: user.id },
          select: ['id'],
        });
        ownedSchools.forEach(school => accessibleSchoolIds.add(school.id));
      }
      if (accessibleSchoolIds.size > 0) {
        query.where('config.schoolId IN (:...schoolIds)', { schoolIds: Array.from(accessibleSchoolIds) });
      } else {
        return [];
      }
    }

    return query.orderBy('config.createdAt', 'DESC').getMany();
  }

  /**
   * Get email configuration for a school
   */
  async findOneBySchoolId(schoolId: string, user: AuthUser): Promise<EmailConfiguration | null> {
    await this.ensureUserHasAccessToSchool(user, schoolId);

    return this.emailConfigurationRepository.findOne({
      where: { schoolId },
      relations: ['school'],
    });
  }

  /**
   * Create or update email configuration
   */
  async upsert(
    createEmailConfigurationDto: CreateEmailConfigurationDto,
    createdBy: string,
    user: AuthUser,
  ): Promise<EmailConfiguration> {
    await this.ensureUserHasAccessToSchool(user, createEmailConfigurationDto.schoolId);

    const existing = await this.emailConfigurationRepository.findOne({
      where: { schoolId: createEmailConfigurationDto.schoolId },
    });
    if (existing) {
      // Update existing
      Object.assign(existing, {
        ...createEmailConfigurationDto,
        isVerified: false, // Reset verification on update
      });
      return this.emailConfigurationRepository.save(existing);
    } else {
      // Create new
      const config = this.emailConfigurationRepository.create({
        ...createEmailConfigurationDto,
        createdBy,
        isVerified: false,
        isActive: true,
      });
      return this.emailConfigurationRepository.save(config);
    }
  }

  /**
   * Update email configuration
   */
  async update(
    id: string,
    updateEmailConfigurationDto: UpdateEmailConfigurationDto,
    user: AuthUser,
  ): Promise<EmailConfiguration> {
    const config = await this.emailConfigurationRepository.findOne({
      where: { id },
      relations: ['school'],
    });

    if (!config) {
      throw new NotFoundException(`Email configuration with ID "${id}" not found`);
    }

    await this.ensureUserHasAccessToSchool(user, config.schoolId);

    Object.assign(config, updateEmailConfigurationDto);
    if (updateEmailConfigurationDto.fromEmail || updateEmailConfigurationDto.fromName) {
      config.isVerified = false; // Reset verification on email/name change
    }

    return this.emailConfigurationRepository.save(config);
  }

  /**
   * Ensure user has access to the school
   */
  private async ensureUserHasAccessToSchool(user: AuthUser, schoolId: string): Promise<void> {
    if (user.primaryRole === AppRole.SUPER_ADMIN) {
      return;
    }

    const accessibleSchoolIds = new Set<string>();
    if (user.schoolId) {
      accessibleSchoolIds.add(user.schoolId);
    }

    user.roles?.forEach((role) => {
      if (role.schoolId) {
        accessibleSchoolIds.add(role.schoolId);
      }
    });

    // For SCHOOL_OWNER, also get schools they own
    if (user.primaryRole === AppRole.SCHOOL_OWNER) {
      const ownedSchools = await this.schoolRepository.find({
        where: { ownerId: user.id },
        select: ['id'],
      });
      ownedSchools.forEach(school => accessibleSchoolIds.add(school.id));
    }

    if (!accessibleSchoolIds.has(schoolId)) {
      throw new ForbiddenException('You do not have access to this school');
    }
  }
}


