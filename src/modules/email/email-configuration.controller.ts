import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { EmailConfigurationService } from './email-configuration.service';
import { CreateEmailConfigurationDto } from './dto/create-email-configuration.dto';
import { UpdateEmailConfigurationDto } from './dto/update-email-configuration.dto';
import { EmailConfigurationResponseDto } from './dto/email-configuration-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AppRole } from '../../common/enums/app-role.enum';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { EmailConfiguration } from './entities/email-configuration.entity';

@ApiTags('Email Configuration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('email/configurations')
export class EmailConfigurationController {
  constructor(private readonly emailConfigurationService: EmailConfigurationService) {}

  @Get()
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({ summary: 'Get email configurations' })
  @ApiQuery({ name: 'schoolId', required: false, type: String, description: 'Filter by school ID' })
  @ApiResponse({
    status: 200,
    description: 'List of email configurations',
    type: [EmailConfigurationResponseDto],
  })
  async findAll(
    @Query('schoolId') schoolId?: string,
    @CurrentUser() user?: AuthUser,
  ): Promise<EmailConfigurationResponseDto[]> {
    const configs = await this.emailConfigurationService.findAll(schoolId, user);
    return configs.map(config => this.mapToResponseDto(config));
  }

  @Get('by-school')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({ summary: 'Get email configuration for a school' })
  @ApiQuery({ name: 'schoolId', required: true, type: String })
  @ApiResponse({
    status: 200,
    description: 'Email configuration found',
    type: EmailConfigurationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Configuration not found' })
  async findOneBySchool(
    @Query('schoolId', ParseUUIDPipe) schoolId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<EmailConfigurationResponseDto | null> {
    const config = await this.emailConfigurationService.findOneBySchoolId(schoolId, user);
    return config ? this.mapToResponseDto(config) : null;
  }

  @Post()
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create or update email configuration' })
  @ApiResponse({
    status: 201,
    description: 'Email configuration created/updated successfully',
    type: EmailConfigurationResponseDto,
  })
  async create(
    @Body() createEmailConfigurationDto: CreateEmailConfigurationDto,
    @CurrentUser() user: AuthUser,
  ): Promise<EmailConfigurationResponseDto> {
    const config = await this.emailConfigurationService.upsert(
      createEmailConfigurationDto,
      user.id,
      user,
    );
    return this.mapToResponseDto(config);
  }

  @Patch(':id')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({ summary: 'Update email configuration' })
  @ApiParam({ name: 'id', description: 'Configuration ID' })
  @ApiResponse({
    status: 200,
    description: 'Email configuration updated successfully',
    type: EmailConfigurationResponseDto,
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateEmailConfigurationDto: UpdateEmailConfigurationDto,
    @CurrentUser() user: AuthUser,
  ): Promise<EmailConfigurationResponseDto> {
    const config = await this.emailConfigurationService.update(
      id,
      updateEmailConfigurationDto,
      user,
    );
    return this.mapToResponseDto(config);
  }

  private mapToResponseDto(config: EmailConfiguration): EmailConfigurationResponseDto {
    return {
      id: config.id,
      schoolId: config.schoolId,
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      replyToEmail: config.replyToEmail,
      smtpProvider: config.smtpProvider,
      isVerified: config.isVerified,
      isActive: config.isActive,
      createdBy: config.createdBy,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }
}


