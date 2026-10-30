import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IncidentReport } from '../../database/entities/incident-report.entity';
import { Incident } from '../../database/entities/incident.entity';
import { IncidentType } from '../../database/entities/incident-type.entity';
import { Attachment } from '../../database/entities/attachment.entity';
import { OutboxEvent } from '../../database/entities/outbox-event.entity';
import { IncidentEvent } from '../../database/entities/incident-event.entity';
import { User } from '../../database/entities/user.entity';
import { SystemSetting } from '../../database/entities/system-setting.entity';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ClockModule } from '../../common/clock/clock.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([IncidentReport, Incident, IncidentType, Attachment, OutboxEvent, IncidentEvent, User, SystemSetting]),
    ClockModule,
    AuditModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
