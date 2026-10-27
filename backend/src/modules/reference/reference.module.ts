import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  IncidentType,
  Organization,
  Region,
  SystemSetting,
  Unit,
} from '../../database/entities';
import { ReferenceService } from './reference.service';
import { ReferenceController } from './reference.controller';
import { ClockModule } from '../../common/clock/clock.module';
import { MeModule } from '../me/me.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([IncidentType, Region, Organization, Unit, SystemSetting]),
    ClockModule,
    MeModule,
  ],
  providers: [ReferenceService],
  controllers: [ReferenceController],
  exports: [ReferenceService],
})
export class ReferenceModule {}
