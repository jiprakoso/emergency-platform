import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { DeviceService } from './device.service';
import { TopicNamingService } from './topic-naming.service';
import { TopicSubscriptionService } from './topic-subscription.service';
import { RegionLookupService } from './region-lookup.service';
import { User } from '../../database/entities/user.entity';
import { StaffProfile } from '../../database/entities/staff-profile.entity';
import { Organization } from '../../database/entities/organization.entity';
import { Unit } from '../../database/entities/unit.entity';
import { Region } from '../../database/entities/region.entity';
import { DeviceToken } from '../../database/entities/device-token.entity';
import { DeviceTopicSubscription } from '../../database/entities/device-topic-subscription.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      StaffProfile,
      Organization,
      Unit,
      Region,
      DeviceToken,
      DeviceTopicSubscription,
    ]),
  ],
  controllers: [MeController],
  providers: [
    MeService,
    DeviceService,
    TopicNamingService,
    TopicSubscriptionService,
    RegionLookupService,
  ],
  exports: [MeService, DeviceService, RegionLookupService, TopicNamingService],
})
export class MeModule {}
