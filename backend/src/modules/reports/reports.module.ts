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
import { MeModule } from '../me/me.module';
import { ReferenceModule } from '../reference/reference.module';
import { ReportViewLoader } from './report-view.loader';

@Module({
  imports: [
    TypeOrmModule.forFeature([IncidentReport, Incident, IncidentType, Attachment, OutboxEvent, IncidentEvent, User, SystemSetting]),
    ClockModule,
    AuditModule,
    MeModule,
    ReferenceModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ReportViewLoader],
  exports: [ReportsService, ReportViewLoader],
})
export class ReportsModule {}
