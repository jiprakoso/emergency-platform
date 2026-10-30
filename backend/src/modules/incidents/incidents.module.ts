import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident } from '../../database/entities/incident.entity';
import { IncidentEvent } from '../../database/entities/incident-event.entity';
import { OutboxEvent } from '../../database/entities/outbox-event.entity';
import { SystemSetting } from '../../database/entities/system-setting.entity';
import { IncidentsService } from './incidents.service';
import { IncidentViewLoader } from './incident-view.loader';
import { IncidentsController } from './incidents.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { AuditModule } from '../audit/audit.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [TypeOrmModule.forFeature([Incident, IncidentEvent, OutboxEvent, SystemSetting]), PermissionsModule, AuditModule, ReportsModule],
  controllers: [IncidentsController],
  providers: [IncidentsService, IncidentViewLoader],
  exports: [IncidentsService, IncidentViewLoader],
})
export class IncidentsModule {}
