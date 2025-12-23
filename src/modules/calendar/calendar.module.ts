import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';
import { EnrollmentEntity } from '../enrollment/entities/enrollment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CalendarEvent, EnrollmentEntity])],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}






