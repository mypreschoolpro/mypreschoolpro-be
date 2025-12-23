import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Query,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AppRole } from '../../common/enums/app-role.enum';

@ApiTags('AI Analytics & Predictions')
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('analyze-billing-issues')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Analyze billing issues for a school',
    description: 'AI-powered analysis to identify billing errors, duplicate charges, failed payments, and inconsistencies',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        schoolId: { type: 'string', format: 'uuid' },
      },
      required: ['schoolId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Billing analysis completed successfully' })
  async analyzeBillingIssues(@Body() body: { schoolId: string }) {
    return this.aiService.analyzeBillingIssues(body.schoolId);
  }

  @Post('analyze-class-insights')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Analyze class insights',
    description: 'AI analysis of class enrollment, capacity, and lead conversion opportunities',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        schoolId: { type: 'string', format: 'uuid' },
        classId: { type: 'string', format: 'uuid' },
      },
      required: ['schoolId', 'classId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Class insights generated successfully' })
  async analyzeClassInsights(@Body() body: { schoolId: string; classId: string }) {
    return this.aiService.analyzeClassInsights(body.schoolId, body.classId);
  }

  @Post('analyze-lead-priority')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN, AppRole.ADMISSIONS_STAFF)
  @ApiOperation({
    summary: 'Analyze lead priority',
    description: 'AI-powered lead priority scoring and conversion likelihood analysis',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        leadId: { type: 'string', format: 'uuid' },
        schoolId: { type: 'string', format: 'uuid' },
      },
      required: ['leadId', 'schoolId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Lead priority analysis completed successfully' })
  async analyzeLeadPriority(@Body() body: { leadId: string; schoolId: string }) {
    return this.aiService.analyzeLeadPriority(body.leadId, body.schoolId);
  }

  @Post('predict-payment-risks')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Predict payment risks',
    description: 'AI prediction of payment failures and families at risk of payment issues',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        schoolId: { type: 'string', format: 'uuid' },
      },
      required: ['schoolId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Payment risk prediction completed successfully' })
  async predictPaymentRisks(@Body() body: { schoolId: string }) {
    return this.aiService.predictPaymentRisks(body.schoolId);
  }

  @Post('predict-revenue')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Predict revenue',
    description: 'AI-powered revenue forecasting based on enrollment and transaction history',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        schoolId: { type: 'string', format: 'uuid' },
        projectionMonths: { type: 'number', default: 12, description: 'Number of months to project' },
      },
      required: ['schoolId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Revenue prediction completed successfully' })
  async predictRevenue(@Body() body: { schoolId: string; projectionMonths?: number }) {
    return this.aiService.predictRevenue(body.schoolId, body.projectionMonths || 12);
  }

  @Post('forecast-enrollment-trends')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Forecast enrollment trends',
    description: 'AI forecasting of enrollment trends and capacity utilization',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        schoolId: { type: 'string', format: 'uuid' },
        timeframeMonths: { type: 'number', default: 12 },
      },
      required: ['schoolId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Enrollment forecast completed successfully' })
  async forecastEnrollmentTrends(@Body() body: { schoolId: string; timeframeMonths?: number }) {
    return this.aiService.forecastEnrollmentTrends(body.schoolId, body.timeframeMonths || 12);
  }

  @Post('predict-class-openings')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Predict class openings',
    description: 'AI prediction of when classes will have openings based on enrollment patterns',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        schoolId: { type: 'string', format: 'uuid' },
        timeframeMonths: { type: 'number', default: 12 },
      },
      required: ['schoolId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Class opening predictions completed successfully' })
  async predictClassOpenings(@Body() body: { schoolId: string; timeframeMonths?: number }) {
    return this.aiService.predictClassOpenings(body.schoolId, body.timeframeMonths || 12);
  }

  @Post('analyze-tour-insights')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN, AppRole.ADMISSIONS_STAFF)
  @ApiOperation({
    summary: 'Analyze tour insights',
    description: 'AI analysis of tour effectiveness and lead engagement',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        leadId: { type: 'string', format: 'uuid' },
      },
      required: ['leadId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Tour insights generated successfully' })
  async analyzeTourInsights(@Body() body: { leadId: string }) {
    return this.aiService.analyzeTourInsights(body.leadId);
  }

  @Post('analyze-class-ratios')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Analyze class ratios',
    description: 'AI analysis of class ratios, compliance, and staffing needs',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        schoolId: { type: 'string', format: 'uuid' },
      },
      required: ['schoolId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Class ratio analysis completed successfully' })
  async analyzeClassRatios(@Body() body: { schoolId: string }) {
    return this.aiService.analyzeClassRatios(body.schoolId);
  }

  @Post('analyze-multi-school-kpis')
  @Roles(AppRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Analyze multi-school KPIs',
    description: 'AI-powered comparative analysis of KPIs across multiple schools',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        schoolIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
      },
      required: ['schoolIds'],
    },
  })
  @ApiResponse({ status: 200, description: 'Multi-school KPI analysis completed successfully' })
  async analyzeMultiSchoolKPIs(@Body() body: { schoolIds: string[] }) {
    return this.aiService.analyzeMultiSchoolKPIs(body.schoolIds);
  }

  @Post('recommend-next-steps')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN, AppRole.ADMISSIONS_STAFF)
  @ApiOperation({
    summary: 'Recommend next steps for a lead',
    description: 'AI recommendations for lead follow-up actions and communication strategy',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        leadId: { type: 'string', format: 'uuid' },
        schoolId: { type: 'string', format: 'uuid' },
      },
      required: ['leadId', 'schoolId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Next steps recommendations generated successfully' })
  async recommendNextSteps(@Body() body: { leadId: string; schoolId: string }) {
    return this.aiService.recommendNextSteps(body.leadId, body.schoolId);
  }

  @Post('recommend-program-assignments')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN, AppRole.ADMISSIONS_STAFF)
  @ApiOperation({
    summary: 'Recommend program assignments',
    description: 'AI recommendations for best program placement for a child',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        leadId: { type: 'string', format: 'uuid' },
        schoolId: { type: 'string', format: 'uuid' },
      },
      required: ['leadId', 'schoolId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Program assignment recommendations generated successfully' })
  async recommendProgramAssignments(@Body() body: { leadId: string; schoolId: string }) {
    return this.aiService.recommendProgramAssignments(body.leadId, body.schoolId);
  }

  @Post('recommend-learning-path')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN, AppRole.TEACHER)
  @ApiOperation({
    summary: 'Recommend learning path',
    description: 'AI-generated personalized learning path recommendations for a student',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        studentData: { type: 'object' },
        progressData: { type: 'object' },
        enrollmentData: { type: 'object' },
      },
      required: ['studentData', 'progressData', 'enrollmentData'],
    },
  })
  @ApiResponse({ status: 200, description: 'Learning path recommendations generated successfully' })
  async recommendLearningPath(@Body() body: { studentData: any; progressData: any; enrollmentData: any }) {
    return this.aiService.recommendLearningPath(body.studentData, body.progressData, body.enrollmentData);
  }

  @Post('recommend-classroom-expansion')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER)
  @ApiOperation({
    summary: 'Recommend classroom expansion',
    description: 'AI recommendations for classroom expansion based on capacity and demand',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        schoolId: { type: 'string', format: 'uuid' },
      },
      required: ['schoolId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Classroom expansion recommendations generated successfully' })
  async recommendClassroomExpansion(@Body() body: { schoolId: string }) {
    return this.aiService.recommendClassroomExpansion(body.schoolId);
  }

  @Post('recommend-expansion-opportunities')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER)
  @ApiOperation({
    summary: 'Recommend expansion opportunities',
    description: 'AI recommendations for business expansion opportunities',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        schoolId: { type: 'string', format: 'uuid' },
      },
      required: ['schoolId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Expansion opportunity recommendations generated successfully' })
  async recommendExpansionOpportunities(@Body() body: { schoolId: string }) {
    return this.aiService.recommendExpansionOpportunities(body.schoolId);
  }

  @Post('generate-family-profile')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN, AppRole.ADMISSIONS_STAFF)
  @ApiOperation({
    summary: 'Generate family profile',
    description: 'AI-generated comprehensive family profile with engagement preferences',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        leadId: { type: 'string', format: 'uuid' },
      },
      required: ['leadId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Family profile generated successfully' })
  async generateFamilyProfile(@Body() body: { leadId: string }) {
    return this.aiService.generateFamilyProfile(body.leadId);
  }

  @Post('generate-response-suggestions')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN, AppRole.ADMISSIONS_STAFF, AppRole.TEACHER)
  @ApiOperation({
    summary: 'Generate response suggestions',
    description: 'AI-generated response suggestions for parent communications',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        context: { type: 'string' },
        messageType: { type: 'string' },
      },
      required: ['context', 'messageType'],
    },
  })
  @ApiResponse({ status: 200, description: 'Response suggestions generated successfully' })
  async generateResponseSuggestions(@Body() body: { context: string; messageType: string }) {
    return this.aiService.generateResponseSuggestions(body.context, body.messageType);
  }

  @Post('parent-qa-assistant')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN, AppRole.ADMISSIONS_STAFF, AppRole.PARENT)
  @ApiOperation({
    summary: 'Parent QA Assistant',
    description: 'AI assistant to answer parent questions about enrollment, policies, and programs',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        messages: { type: 'array', items: { type: 'object' } },
        schoolContext: { type: 'object' },
      },
      required: ['messages', 'schoolContext'],
    },
  })
  @ApiResponse({ status: 200, description: 'QA response generated successfully' })
  async parentQAAssistant(@Body() body: { messages: any[]; schoolContext: any }) {
    return this.aiService.parentQAAssistant(body.messages, body.schoolContext);
  }

  @Post('analyze-developmental-milestones')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN, AppRole.TEACHER, AppRole.PARENT)
  @ApiOperation({
    summary: 'Analyze developmental milestones',
    description: 'AI analysis of student progress against age-appropriate developmental milestones',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        studentData: { type: 'object' },
        progressData: { type: 'object' },
        enrollmentData: { type: 'object' },
      },
      required: ['studentData', 'progressData', 'enrollmentData'],
    },
  })
  @ApiResponse({ status: 200, description: 'Developmental milestone analysis completed successfully' })
  async analyzeDevelopmentalMilestones(@Body() body: { studentData: any; progressData: any; enrollmentData: any }) {
    return this.aiService.analyzeDevelopmentalMilestones(body.studentData, body.progressData, body.enrollmentData);
  }

  @Post('recommend-meeting-times')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN, AppRole.ADMISSIONS_STAFF)
  @ApiOperation({
    summary: 'Recommend meeting times',
    description: 'AI recommendations for optimal meeting times based on participant availability',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        participants: { type: 'array', items: { type: 'object' } },
        constraints: { type: 'object' },
      },
      required: ['participants', 'constraints'],
    },
  })
  @ApiResponse({ status: 200, description: 'Meeting time recommendations generated successfully' })
  async recommendMeetingTimes(@Body() body: { participants: any[]; constraints: any }) {
    return this.aiService.recommendMeetingTimes(body.participants, body.constraints);
  }

  @Post('analyze-compliance-status')
  @Roles(AppRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Analyze compliance status across all schools',
    description: 'AI-powered compliance analysis for all active schools, identifying critical issues and upcoming deadlines',
  })
  @ApiResponse({ status: 200, description: 'Compliance analysis completed successfully' })
  async analyzeComplianceStatus() {
    return this.aiService.analyzeComplianceStatus();
  }

  @Post('optimize-staff-coverage')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Optimize staff coverage for a school',
    description: 'AI-powered staff scheduling optimization to maintain teacher-student ratios and handle coverage gaps',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        schoolId: { type: 'string', format: 'uuid' },
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date' },
      },
      required: ['schoolId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Staff coverage optimization completed successfully' })
  async optimizeStaffCoverage(@Body() body: { schoolId: string; startDate?: string; endDate?: string }) {
    return this.aiService.optimizeStaffCoverage(body.schoolId, body.startDate, body.endDate);
  }

  @Post('check-staff-compliance')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Check staff compliance for a school',
    description: 'AI-powered analysis of staff document compliance, identifying missing or expiring certifications',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        schoolId: { type: 'string', format: 'uuid' },
      },
      required: ['schoolId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Staff compliance check completed successfully' })
  async checkStaffCompliance(@Body() body: { schoolId: string }) {
    return this.aiService.checkStaffCompliance(body.schoolId);
  }
}


