import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiUnauthorizedResponse,
  ApiBody,
  ApiConsumes,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { S3Service } from '../media/s3.service';
import { SchoolEntity } from '../schools/entities/school.entity';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AppRole } from '../../common/enums/app-role.enum';
import { CreateStaffInvitationDto } from './dto/create-staff-invitation.dto';
import { StaffInvitationResponseDto } from './dto/staff-invitation-response.dto';
import { UpdateStaffRoleDto } from './dto/update-staff-role.dto';
import { UpdateStaffStatusDto } from './dto/update-staff-status.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersQueryDto } from './dto/users-query.dto';
import { MailerService } from '../mailer/mailer.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createClient } from '@supabase/supabase-js';
import { ImpersonationSession } from './entities/impersonation-session.entity';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly s3Service: S3Service,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    @InjectRepository(SchoolEntity)
    private readonly schoolRepository: Repository<SchoolEntity>,
    @InjectRepository(ImpersonationSession)
    private readonly impersonationRepository: Repository<ImpersonationSession>,
  ) {}

  private async ensureUserCanManageSchool(user: AuthUser, schoolId?: string): Promise<void> {
    if (!schoolId) {
      throw new BadRequestException('schoolId is required');
    }

    if (user.primaryRole === AppRole.SUPER_ADMIN) {
      return;
    }

    const accessible = new Set<string>();
    if (user.schoolId) {
      accessible.add(user.schoolId);
    }
    user.roles?.forEach((role) => {
      if (role.schoolId) {
        accessible.add(role.schoolId);
      }
    });

    // For SCHOOL_OWNER, check if they own the specific school or any schools
    const hasSchoolOwnerRole = user.roles?.some(role => role.role === AppRole.SCHOOL_OWNER);
    if (hasSchoolOwnerRole) {
      // First, directly check if the requested school is owned by this user
      const requestedSchool = await this.schoolRepository.findOne({
        where: { id: schoolId, ownerId: user.id },
        select: ['id'],
      });
      
      if (requestedSchool) {
        // User owns the requested school, allow access
        return;
      }
      
      // Also get all schools they own for other checks
      const ownedSchools = await this.schoolRepository.find({
        where: { ownerId: user.id },
        select: ['id'],
      });
      ownedSchools.forEach(school => accessible.add(school.id));
    }

    if (!accessible.has(schoolId)) {
      throw new ForbiddenException('You can only manage your own school');
    }
  }

  @Get('profiles/by-email')
  @ApiOperation({
    summary: 'Get profile by email',
    description: 'Retrieve a user profile by email address. Returns minimal profile info (id, email).',
  })
  @ApiQuery({
    name: 'email',
    description: 'Email address',
    example: 'user@example.com',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Profile retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: '123e4567-e89b-12d3-a456-426614174000' },
        email: { type: 'string', example: 'user@example.com' },
      },
      nullable: true,
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getProfileByEmail(@Query('email') email: string): Promise<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    status: string;
  } | null> {
    if (!email) {
      throw new BadRequestException('Email parameter is required');
    }

    const profile = await this.usersService.findProfileByEmail(email);

    if (!profile) {
      return null;
    }

    return {
      id: profile.id,
      email: profile.email,
      first_name: profile.firstName,
      last_name: profile.lastName,
      status: profile.status,
    };
  }

  @Get('roles/batch')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get user roles for multiple users (batch)',
    description: 'Get roles for multiple users in a single query. Returns a map of userId -> roles array.',
  })
  @ApiQuery({
    name: 'userIds',
    required: true,
    type: String,
    description: 'Comma-separated list of user IDs',
    example: 'uuid1,uuid2,uuid3',
  })
  @ApiResponse({
    status: 200,
    description: 'User roles retrieved successfully',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            userId: { type: 'string' },
            role: { type: 'string' },
            schoolId: { type: 'string', nullable: true },
          },
        },
      },
      example: {
        'uuid1': [{ id: 'role1', userId: 'uuid1', role: 'school_admin', schoolId: 'school1' }],
        'uuid2': [{ id: 'role2', userId: 'uuid2', role: 'teacher', schoolId: 'school1' }],
        'uuid3': [],
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getUserRolesBatch(@Query('userIds') userIds: string): Promise<Record<string, Array<{ id: string; userId: string; role: string; schoolId: string | null }>>> {
    if (!userIds) {
      throw new BadRequestException('userIds parameter is required');
    }

    const userIdArray = userIds.split(',').map((id) => id.trim()).filter(Boolean);
    
    if (userIdArray.length === 0) {
      throw new BadRequestException('At least one user ID is required');
    }

    const rolesMap = await this.usersService.findRolesByUserIds(userIdArray);

    // Transform to response format
    const result: Record<string, Array<{ id: string; userId: string; role: string; schoolId: string | null }>> = {};
    Object.keys(rolesMap).forEach((userId) => {
      result[userId] = rolesMap[userId].map((role) => ({
        id: role.id,
        userId: role.userId,
        role: role.role,
        schoolId: role.schoolId,
      }));
    });

    return result;
  }

  @Get('login-counts/batch')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get login counts for multiple users (batch)',
    description: 'Get login counts for multiple users in a single query. Returns a map of userId -> loginCount.',
  })
  @ApiQuery({
    name: 'userIds',
    required: true,
    type: String,
    description: 'Comma-separated list of user IDs',
    example: 'uuid1,uuid2,uuid3',
  })
  @ApiResponse({
    status: 200,
    description: 'Login counts retrieved successfully',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'number',
      },
      example: {
        'uuid1': 15,
        'uuid2': 3,
        'uuid3': 0,
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getLoginCountsBatch(@Query('userIds') userIds: string): Promise<Record<string, number>> {
    if (!userIds) {
      throw new BadRequestException('userIds parameter is required');
    }

    const userIdArray = userIds.split(',').map((id) => id.trim()).filter(Boolean);
    
    if (userIdArray.length === 0) {
      throw new BadRequestException('At least one user ID is required');
    }

    return this.usersService.getLoginCountsByUserIds(userIdArray);
  }

  @Get('roles/count')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get user roles count',
    description: 'Get the total count of user roles, optionally filtered by role types.',
  })
  @ApiQuery({
    name: 'roles',
    required: false,
    type: String,
    description: 'Comma-separated list of roles to filter by (e.g., school_admin,admissions_staff,teacher)',
    example: 'school_admin,admissions_staff,teacher',
  })
  @ApiResponse({
    status: 200,
    description: 'Count retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        count: { type: 'number', example: 125 },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getUserRolesCount(@Query('roles') roles?: string): Promise<{ count: number }> {
    const roleArray = roles
      ? roles.split(',').map((r) => r.trim() as AppRole)
      : undefined;

    const count = await this.usersService.countUserRoles(roleArray);
    return { count };
  }

  @Get('me/school')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SCHOOL_ADMIN, AppRole.ADMISSIONS_STAFF, AppRole.TEACHER, AppRole.SCHOOL_OWNER)
  @ApiOperation({
    summary: 'Get my school',
    description: 'Get the school associated with the current user. For school_admin, admissions_staff, and teacher, returns their assigned school. For school_owner, returns the first school they own.',
  })
  @ApiResponse({
    status: 200,
    description: 'School retrieved successfully',
    type: SchoolEntity,
  })
  @ApiResponse({
    status: 404,
    description: 'No school found for this user',
  })
  async getMySchool(@CurrentUser() user: AuthUser): Promise<SchoolEntity> {
    const school = await this.usersService.findSchoolByUser(user.id, user.primaryRole);
    
    if (!school) {
      throw new NotFoundException('No school found for this user');
    }

    return school;
  }

  @Get('profiles/count')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Get total number of profiles',
    description: 'Returns the total count of user profiles, optionally filtered by status or school.',
  })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'schoolId', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Profile count retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        count: { type: 'number', example: 452 },
      },
    },
  })
  async countProfiles(
    @Query('status') status?: string,
    @Query('schoolId') schoolId?: string,
  ): Promise<{ count: number }> {
    const count = await this.usersService.countProfiles({ status, schoolId });
    return { count };
  }

  @Get('profiles/:id')
  @ApiOperation({
    summary: 'Get profile by ID',
    description: 'Retrieve a user profile by ID. Returns id, email, first_name, last_name, phone, and status.',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile retrieved successfully',
    type: ProfileResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getProfile(@Param('id') id: string): Promise<ProfileResponseDto> {
    const profile = await this.usersService.findProfileById(id);

    if (!profile) {
      throw new NotFoundException(`Profile with ID "${id}" not found`);
    }

    return {
      id: profile.id,
      email: profile.email,
      first_name: profile.firstName,
      last_name: profile.lastName,
      phone: profile.phone,
      address: profile.address,
      city: profile.city,
      state: profile.state,
      zip_code: profile.zipCode,
      avatar_url: profile.avatarUrl,
      bio: profile.bio,
      status: profile.status,
      created_at: profile.createdAt,
      updated_at: profile.updatedAt,
    };
  }

  @Put('profiles/:id')
  @ApiOperation({
    summary: 'Update profile',
    description: 'Update a user profile. Users can only update their own profile.',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({
    type: UpdateProfileDto,
    description: 'Profile update data',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile updated successfully',
    type: ProfileResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async updateProfile(
    @Param('id') id: string,
    @Body() updateDto: UpdateProfileDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ProfileResponseDto> {
    // Users can only update their own profile
    if (user.id !== id) {
      throw new ForbiddenException('You can only update your own profile');
    }

    const profile = await this.usersService.findProfileById(id);
    if (!profile) {
      throw new NotFoundException(`Profile with ID "${id}" not found`);
    }

    // Update profile fields
    const updatedProfile = await this.usersService.upsertProfile({
      id,
      firstName: updateDto.first_name ?? profile.firstName,
      lastName: updateDto.last_name ?? profile.lastName,
      email: updateDto.email ?? profile.email,
      phone: updateDto.phone ?? profile.phone,
      address: updateDto.address !== undefined ? updateDto.address : profile.address,
      city: updateDto.city !== undefined ? updateDto.city : profile.city,
      state: updateDto.state !== undefined ? updateDto.state : profile.state,
      zipCode: updateDto.zip_code !== undefined ? updateDto.zip_code : profile.zipCode,
      avatarUrl: updateDto.avatar_url !== undefined ? updateDto.avatar_url : profile.avatarUrl,
      bio: updateDto.bio !== undefined ? updateDto.bio : profile.bio,
    });

    return {
      id: updatedProfile.id,
      email: updatedProfile.email,
      first_name: updatedProfile.firstName,
      last_name: updatedProfile.lastName,
      phone: updatedProfile.phone,
      address: updatedProfile.address,
      city: updatedProfile.city,
      state: updatedProfile.state,
      zip_code: updatedProfile.zipCode,
      avatar_url: updatedProfile.avatarUrl,
      bio: updatedProfile.bio,
      status: updatedProfile.status,
      created_at: updatedProfile.createdAt,
      updated_at: updatedProfile.updatedAt,
    };
  }

  @Post('profiles/:id/avatar')
  @ApiOperation({
    summary: 'Upload profile avatar',
    description: 'Upload a profile avatar image to S3 and update the profile avatar_url.',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Avatar image file (max 5MB, images only)',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Avatar uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        avatar_url: {
          type: 'string',
          example: 'https://bucket.s3.region.amazonaws.com/avatars/user-id/file.jpg',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request - invalid file or missing data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - can only upload your own avatar' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
      },
      fileFilter: (req, file, callback) => {
        if (file.mimetype.startsWith('image/')) {
          callback(null, true);
        } else {
          callback(
            new BadRequestException('Invalid file type. Only image files are allowed.'),
            false,
          );
        }
      },
    }),
  )
  async uploadAvatar(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ): Promise<{ avatar_url: string }> {
    // Users can only upload their own avatar
    if (user.id !== id) {
      throw new ForbiddenException('You can only upload your own avatar');
    }

    if (!file) {
      throw new BadRequestException('File is required');
    }

    const profile = await this.usersService.findProfileById(id);
    if (!profile) {
      throw new NotFoundException(`Profile with ID "${id}" not found`);
    }

    // Upload to S3 in avatars folder
    const folder = `avatars/${id}`;
    const { fileUrl } = await this.s3Service.uploadFile(file, folder);

    // Update profile with new avatar URL
    const updatedProfile = await this.usersService.upsertProfile({
      id,
      avatarUrl: fileUrl,
    });

    return {
      avatar_url: updatedProfile.avatarUrl || '',
    };
  }

  @Get('profiles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List profiles',
    description: 'Retrieve a paginated list of user profiles with optional filters.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  @ApiQuery({ name: 'status', required: false, type: String, example: 'active' })
  @ApiQuery({ name: 'schoolId', required: false, type: String })
  @ApiQuery({ name: 'createdAfter', required: false, type: String, description: 'ISO date string' })
  @ApiQuery({ name: 'createdBefore', required: false, type: String, description: 'ISO date string' })
  @ApiQuery({ name: 'order', required: false, type: String, enum: ['ASC', 'DESC'], example: 'DESC' })
  @ApiResponse({
    status: 200,
    description: 'Profiles retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/ProfileResponseDto' } },
        total: { type: 'number', example: 120 },
      },
    },
  })
  async listProfiles(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('status') status?: string,
    @Query('schoolId') schoolId?: string,
    @Query('createdAfter') createdAfter?: string,
    @Query('createdBefore') createdBefore?: string,
    @Query('order') order: 'ASC' | 'DESC' = 'DESC',
  ): Promise<{ data: ProfileResponseDto[]; total: number }> {
    const parsedLimit = limit !== undefined ? Number(limit) : 50;
    const parsedOffset = offset !== undefined ? Number(offset) : 0;
    const parsedCreatedAfter = createdAfter ? new Date(createdAfter) : undefined;
    const parsedCreatedBefore = createdBefore ? new Date(createdBefore) : undefined;

    const { data, total } = await this.usersService.findProfiles({
      limit: parsedLimit,
      offset: parsedOffset,
      status,
      schoolId,
      createdAfter: parsedCreatedAfter,
      createdBefore: parsedCreatedBefore,
      order,
    });

    return {
      data: data.map((profile) => ({
        id: profile.id,
        email: profile.email,
        first_name: profile.firstName,
        last_name: profile.lastName,
        phone: profile.phone,
        address: profile.address,
        city: profile.city,
        state: profile.state,
        zip_code: profile.zipCode,
        status: profile.status,
        avatar_url: profile.avatarUrl,
        bio: profile.bio,
        created_at: profile.createdAt,
        updated_at: profile.updatedAt,
      })),
      total,
    };
  }


  @Get('staff')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.SCHOOL_OWNER)
  @ApiOperation({
    summary: 'List staff members for a school',
    description: 'Returns staff assignments (with profile info) for a given school and optional role filter.',
  })
  @ApiQuery({ name: 'schoolId', required: true, type: String })
  @ApiQuery({ name: 'roles', required: false, description: 'Comma-separated list of roles to include' })
  @ApiResponse({
    status: 200,
    description: 'Staff members retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          role: { type: 'string' },
          profile: {
            type: 'object',
            nullable: true,
            properties: {
              first_name: { type: 'string', nullable: true },
              last_name: { type: 'string', nullable: true },
              email: { type: 'string', nullable: true },
              phone: { type: 'string', nullable: true },
              status: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  })
  async listStaff(
    @Query('schoolId') schoolId: string,
    @Query('roles') rolesQuery?: string,
  ): Promise<
    Array<{
      id: string;
      user_id: string;
      role: AppRole;
      created_at: string;
      profile: {
        first_name: string | null;
        last_name: string | null;
        email: string;
        phone: string | null;
        status: string;
      } | null;
    }>
  > {
    if (!schoolId) {
      throw new BadRequestException('schoolId is required');
    }

    const roles = rolesQuery
      ? (rolesQuery
          .split(',')
          .map((role) => role.trim())
          .filter(Boolean) as AppRole[])
      : [AppRole.ADMISSIONS_STAFF];

    const staff = await this.usersService.findStaffBySchool(schoolId, roles);

    return staff.map((assignment) => ({
      id: assignment.id,
      user_id: assignment.userId,
      role: assignment.role,
      created_at: assignment.createdAt?.toISOString?.() ?? '',
      profile: assignment.profile
        ? {
            first_name: assignment.profile.firstName,
            last_name: assignment.profile.lastName,
            email: assignment.profile.email,
            phone: assignment.profile.phone,
            status: assignment.profile.status,
          }
        : null,
    }));
  }

  @Get('staff/invitations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'List pending staff invitations',
    description: 'Returns pending and unexpired staff invitations for a school.',
  })
  @ApiQuery({ name: 'schoolId', required: true, type: String })
  @ApiResponse({
    status: 200,
    description: 'Invitations retrieved successfully',
    type: [StaffInvitationResponseDto],
  })
  async listStaffInvitations(
    @Query('schoolId') schoolId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StaffInvitationResponseDto[]> {
    await this.ensureUserCanManageSchool(user, schoolId);

    const invitations = await this.usersService.getPendingStaffInvitations(schoolId);

    return invitations.map((invitation) => ({
      id: invitation.id,
      schoolId: invitation.schoolId,
      invitedEmail: invitation.invitedEmail,
      invitedRole: invitation.invitedRole,
      status: invitation.acceptedAt ? 'accepted' : 'pending',
      expiresAt: invitation.expiresAt?.toISOString() ?? '',
      createdAt: invitation.createdAt?.toISOString() ?? '',
    }));
  }

  @Post('staff/invitations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Create a staff invitation',
    description: 'Creates a pending staff invitation and sends the email via the mailer service.',
  })
  @ApiResponse({
    status: 201,
    description: 'Invitation sent or role assigned',
  })
  async createStaffInvitation(
    @Body() dto: CreateStaffInvitationDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ status: 'invitation_sent' | 'role_assigned'; invitation?: StaffInvitationResponseDto }> {
    await this.ensureUserCanManageSchool(user, dto.schoolId);

    const normalizedEmail = dto.email.toLowerCase();
    const existingProfile = await this.usersService.findProfileByEmail(normalizedEmail);

    if (existingProfile) {
      const alreadyHasRole = await this.usersService.hasRole(existingProfile.id, dto.role, dto.schoolId);
      if (alreadyHasRole) {
        throw new BadRequestException('User already has this role for the school');
      }

      await this.usersService.assignRole(existingProfile.id, dto.role, dto.schoolId);
      return { status: 'role_assigned' };
    }

    const token = randomUUID();
    const invitation = await this.usersService.createStaffInvitation({
      schoolId: dto.schoolId,
      email: normalizedEmail,
      role: dto.role,
      invitedBy: user.id,
      token,
    });

    const appUrl =
      this.configService.get<string>('app.frontendUrl') ||
      this.configService.get<string>('APP_URL', 'http://localhost:5173');
    const invitationLink = `${appUrl.replace(/\/$/, '')}/invite/accept?token=${token}`;

    // Get inviter's name for the email
    const inviterProfile = await this.usersService.findProfileById(user.id);
    const inviterName = inviterProfile 
      ? `${inviterProfile.firstName || ''} ${inviterProfile.lastName || ''}`.trim() || 'School Administrator'
      : 'School Administrator';

    // Send invitation email and check result
    const emailResult = await this.mailerService.sendStaffInvitation({
      schoolId: dto.schoolId,
      email: normalizedEmail,
      role: dto.role,
      schoolName: dto.schoolName || 'Your School',
      invitedBy: inviterName,
      invitationToken: token,
      invitationLink,
    });

    // Log email result - check if email was sent successfully
    if (!emailResult.success) {
      this.logger.warn(`⚠️ Staff invitation email failed to send to ${normalizedEmail}. Invitation created but email delivery failed. Check email logs for details.`);
      // Don't throw error - invitation is created, just email failed
      // The invitation can still be accepted via the link if shared manually
    } else {
      const skipped = (emailResult as any).skipped;
      if (skipped) {
        const reason = (emailResult as any).reason || 'User preference disabled';
        this.logger.log(`📧 Staff invitation email skipped for ${normalizedEmail}: ${reason}`);
      } else {
        this.logger.log(`✅ Staff invitation email sent successfully to ${normalizedEmail}${emailResult.emailId ? ` (email ID: ${emailResult.emailId})` : ''}`);
      }
    }

    return {
      status: 'invitation_sent',
      invitation: {
        id: invitation.id,
        schoolId: invitation.schoolId,
        invitedEmail: invitation.invitedEmail,
        invitedRole: invitation.invitedRole,
        status: 'pending',
        expiresAt: invitation.expiresAt?.toISOString() ?? '',
        createdAt: invitation.createdAt?.toISOString() ?? '',
      },
    };
  }

  @Delete('staff/invitations/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Cancel a staff invitation',
    description: 'Deletes a pending staff invitation.',
  })
  @ApiResponse({ status: 200, description: 'Invitation cancelled' })
  async deleteStaffInvitation(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ success: boolean }> {
    const invitation = await this.usersService.findInvitationById(id);
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    await this.ensureUserCanManageSchool(user, invitation.schoolId);
    await this.usersService.deleteInvitation(id);

    return { success: true };
  }

  @Patch('staff/:roleId/role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Update staff role assignment',
    description: 'Updates the staff role assignment and optionally profile names.',
  })
  @ApiResponse({ status: 200, description: 'Staff role updated' })
  async updateStaffRole(
    @Param('roleId') roleId: string,
    @Body() dto: UpdateStaffRoleDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ id: string; role: AppRole }> {
    const assignment = await this.usersService.findRoleById(roleId);
    if (!assignment) {
      throw new NotFoundException('Staff assignment not found');
    }

    await this.ensureUserCanManageSchool(user, assignment.schoolId || user.schoolId || undefined);

    const updated = await this.usersService.updateStaffRole(roleId, dto.role);
    if (!updated) {
      throw new NotFoundException('Staff assignment not found');
    }

    if (dto.first_name || dto.last_name) {
      await this.usersService.updateProfileNames(
        assignment.userId,
        dto.first_name ?? undefined,
        dto.last_name ?? undefined,
      );
    }

    return { id: updated.id, role: updated.role };
  }

  @Patch('staff/:userId/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Update staff member status',
    description: 'Sets the active or inactive status for a staff member profile.',
  })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  async updateStaffStatus(
    @Param('userId') userId: string,
    @Body() dto: UpdateStaffStatusDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ status: string }> {
    const assignment = await this.usersService.findRoleById(dto.roleId);
    if (!assignment || assignment.userId !== userId) {
      throw new BadRequestException('Invalid role assignment for user');
    }

    await this.ensureUserCanManageSchool(user, assignment.schoolId || user.schoolId || undefined);
    await this.usersService.updateProfileStatus(userId, dto.status);

    return { status: dto.status };
  }

  @Delete('staff/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove staff member from school',
    description: 'Removes a staff member\'s role assignment for a specific school.',
  })
  @ApiQuery({ name: 'schoolId', required: true, type: String, description: 'School ID' })
  @ApiResponse({ status: 204, description: 'Staff member removed successfully' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async removeStaffMember(
    @Param('userId') userId: string,
    @Query('schoolId') schoolId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.ensureUserCanManageSchool(user, schoolId);

    // Find the role assignment for this user and school
    const roles = await this.usersService.findRolesByUserId(userId);
    const roleToRemove = roles.find((r) => r.schoolId === schoolId);

    if (!roleToRemove) {
      throw new NotFoundException('Staff member not found for this school');
    }

    await this.usersService.removeRole(roleToRemove.id);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Get all users with roles and schools',
    description: 'Retrieve all users with their roles and school associations (super admin only). Supports pagination, search, filtering, and sorting.',
  })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              firstName: { type: 'string', nullable: true },
              lastName: { type: 'string', nullable: true },
              email: { type: 'string' },
              status: { type: 'string' },
              createdAt: { type: 'string' },
              role: { type: 'string', nullable: true },
              schoolId: { type: 'string', nullable: true },
              schoolName: { type: 'string', nullable: true },
            },
          },
        },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  async getAllUsers(@Query() query: UsersQueryDto): Promise<{
    data: Array<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
      status: string;
      createdAt: Date;
      role: AppRole | null;
      schoolId: string | null;
      schoolName: string | null;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    return this.usersService.findAllUsersWithRolesAndSchools({
      page: query.page,
      limit: query.limit,
      search: query.search,
      role: query.role,
      status: query.status,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
  }

  @Get(':id/roles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN,AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Get user roles',
    description: 'Get all roles for a user (super admin only).',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
  })
  @ApiResponse({
    status: 200,
    description: 'User roles retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          role: { type: 'string' },
          schoolId: { type: 'string', nullable: true },
        },
      },
    },
  })
  async getUserRoles(@Param('id') id: string): Promise<
    Array<{
      id: string;
      role: AppRole;
      schoolId: string | null;
    }>
  > {
    const roles = await this.usersService.findRolesByUserId(id);
    return roles.map((r) => ({
      id: r.id,
      role: r.role,
      schoolId: r.schoolId,
    }));
  }

  @Put('profiles/:id/admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update profile (admin override)',
    description: 'Update any user profile (super admin only).',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
  })
  @ApiBody({
    type: UpdateProfileDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Profile updated successfully',
    type: ProfileResponseDto,
  })
  async updateProfileAdmin(
    @Param('id') id: string,
    @Body() updateDto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    const profile = await this.usersService.findProfileById(id);
    if (!profile) {
      throw new NotFoundException(`Profile with ID "${id}" not found`);
    }

    const updatedProfile = await this.usersService.upsertProfile({
      id,
      firstName: updateDto.first_name ?? profile.firstName,
      lastName: updateDto.last_name ?? profile.lastName,
      email: updateDto.email ?? profile.email,
      phone: updateDto.phone ?? profile.phone,
      address: updateDto.address !== undefined ? updateDto.address : profile.address,
      city: updateDto.city !== undefined ? updateDto.city : profile.city,
      state: updateDto.state !== undefined ? updateDto.state : profile.state,
      zipCode: updateDto.zip_code !== undefined ? updateDto.zip_code : profile.zipCode,
      avatarUrl: updateDto.avatar_url !== undefined ? updateDto.avatar_url : profile.avatarUrl,
      bio: updateDto.bio !== undefined ? updateDto.bio : profile.bio,
      status: (updateDto as any).status ?? profile.status,
    });

    return {
      id: updatedProfile.id,
      email: updatedProfile.email,
      first_name: updatedProfile.firstName,
      last_name: updatedProfile.lastName,
      phone: updatedProfile.phone,
      address: updatedProfile.address,
      city: updatedProfile.city,
      state: updatedProfile.state,
      zip_code: updatedProfile.zipCode,
      avatar_url: updatedProfile.avatarUrl,
      bio: updatedProfile.bio,
      status: updatedProfile.status,
      created_at: updatedProfile.createdAt,
      updated_at: updatedProfile.updatedAt,
    };
  }

  @Patch(':id/roles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update user roles',
    description: 'Update user roles and school associations (super admin only).',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['roles'],
      properties: {
        roles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: Object.values(AppRole) },
              schoolId: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Roles updated successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          role: { type: 'string' },
          schoolId: { type: 'string', nullable: true },
        },
      },
    },
  })
  async updateUserRoles(
    @Param('id') id: string,
    @Body() body: { roles: Array<{ role: AppRole; schoolId?: string | null }> },
  ): Promise<Array<{ id: string; role: AppRole; schoolId: string | null }>> {
    const roles = await this.usersService.upsertRoles(id, body.roles);
    return roles.map((r) => ({
      id: r.id,
      role: r.role,
      schoolId: r.schoolId,
    }));
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update user status',
    description: 'Update the status of any user (super admin only).',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['status'],
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'suspended', 'inactive'],
          example: 'active',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Status updated successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
      },
    },
  })
  async updateUserStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
  ): Promise<{ status: string }> {
    await this.usersService.updateProfileStatus(id, body.status);
    return { status: body.status };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Delete a user',
    description: 'Permanently delete a user and all associated data (super admin only).',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
  })
  @ApiResponse({
    status: 204,
    description: 'User deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async deleteUser(@Param('id') id: string): Promise<void> {
    await this.usersService.deleteUser(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new user',
    description: 'Create a new user with profile, role, and optionally school ownership (super admin only).',
  })
  @ApiBody({
    type: CreateUserDto,
  })
  @ApiResponse({
    status: 201,
    description: 'User created successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        email: { type: 'string' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        role: { type: 'string' },
        schoolId: { type: 'string', nullable: true },
        schoolIds: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  async createUser(
    @Body() createUserDto: CreateUserDto,
  ): Promise<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: AppRole;
    schoolId: string | null;
    schoolIds: string[];
  }> {
    return this.usersService.createUser(createUserDto);
  }

  @Post(':id/impersonate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AppRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Impersonate a user',
    description: 'Generate a magic link to impersonate another user (super admin only).',
  })
  @ApiParam({
    name: 'id',
    description: 'Target user ID to impersonate',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['redirectTo'],
      properties: {
        redirectTo: {
          type: 'string',
          description: 'URL to redirect to after impersonation',
          example: 'http://localhost:5173/parent',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Impersonation link generated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        action_link: { type: 'string' },
      },
    },
  })
  async impersonateUser(
    @Param('id') targetUserId: string,
    @Body() body: { redirectTo: string },
    @CurrentUser() user: AuthUser,
  ): Promise<{ success: boolean; action_link: string }> {
    // For now, we'll need to call Supabase Admin API
    // This requires Supabase service role key
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseServiceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new BadRequestException('Supabase configuration missing');
    }

    // Get target user profile
    const targetProfile = await this.usersService.findProfileById(targetUserId);
    if (!targetProfile) {
      throw new NotFoundException(`User with ID "${targetUserId}" not found`);
    }

    // Get target user's role
    const targetRoles = await this.usersService.findRolesByUserId(targetUserId);
    if (targetRoles.length === 0) {
      throw new BadRequestException('Target user has no roles assigned');
    }

    // Check if target is super admin
    const isSuperAdmin = targetRoles.some((r) => r.role === AppRole.SUPER_ADMIN);
    if (isSuperAdmin) {
      throw new ForbiddenException('Cannot impersonate other Super Admins');
    }

    // Use Supabase Admin API to generate magic link
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const redirectUrl = body.redirectTo.includes('?')
      ? `${body.redirectTo}&impersonation=true`
      : `${body.redirectTo}?impersonation=true`;

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: targetProfile.email,
      options: {
        redirectTo: redirectUrl,
      },
    });

    if (linkError || !linkData?.properties?.action_link) {
      throw new BadRequestException(
        `Failed to generate impersonation link: ${linkError?.message || 'Unknown error'}`,
      );
    }

    // Log impersonation
    await this.impersonationRepository.save({
      superAdminId: user.id,
      impersonatedUserId: targetUserId,
      isActive: true,
      startedAt: new Date(),
    });

    return {
      success: true,
      action_link: linkData.properties.action_link,
    };
  }
}

