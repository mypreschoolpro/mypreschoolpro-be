import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IncidentReport } from './entities/incident-report.entity';
import { Student } from '../students/entities/student.entity';
import { ProfileEntity } from '../users/entities/profile.entity';
import { SchoolEntity } from '../schools/entities/school.entity';
import { IncidentsService } from './incidents.service';
import { IncidentsController } from './incidents.controller';
import { CommunicationsModule } from '../communications/communications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([IncidentReport, Student, ProfileEntity, SchoolEntity]),
    CommunicationsModule,
  ],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}







