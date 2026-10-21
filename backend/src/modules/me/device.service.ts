import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { DeviceToken } from '../../database/entities/device-token.entity';
import { User } from '../../database/entities/user.entity';
import { ClockService } from '../../common/clock/clock.service';
import { AppError } from '../../common/errors/app-error';
import { TopicNamingService } from './topic-naming.service';
import { TopicSubscriptionService } from './topic-subscription.service';
import { RegionLookupService } from './region-lookup.service';
import { DeviceInfoDto } from '../auth/dto/auth.dto';

@Injectable()
export class DeviceService {
  constructor(
    @InjectRepository(DeviceToken) private readonly devices: Repository<DeviceToken>,
    private readonly topics: TopicNamingService,
    private readonly subscriptions: TopicSubscriptionService,
    private readonly regionLookup: RegionLookupService,
    private readonly clock: ClockService,
  ) {}

  /**
   * Daftar/perbarui token FCM (REST §5.1). Token yang sudah terikat ke pengguna
   * lain dipindahkan ke pengguna ini; topik disinkronkan. Bila `fcmToken` tidak
   * ada (mis. dashboard web), tidak ada baris perangkat dan kembalian `null`.
   */
  async register(user: User, device: DeviceInfoDto): Promise<DeviceToken | null> {
    if (!device.fcmToken) {
      return null;
    }
    const now = this.clock.now();
    let row = await this.devices.findOne({ where: { fcmToken: device.fcmToken } });

    if (row) {
      if (row.userId !== user.id) {
        await this.subscriptions.clearAll(row.id);
      }
      row.userId = user.id;
      row.platform = device.platform;
      row.appFlavor = device.appFlavor;
      row.appVersion = device.appVersion;
      row.pushEnabled = device.pushEnabled ?? true;
      row.revokedAt = null;
      row.lastSeenAt = now;
      row.updatedAt = now;
      await this.devices.save(row);
    } else {
      row = await this.devices.save(
        this.devices.create({
          userId: user.id,
          fcmToken: device.fcmToken,
          platform: device.platform,
          appFlavor: device.appFlavor,
          appVersion: device.appVersion,
          pushEnabled: device.pushEnabled ?? true,
          lastSeenAt: now,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    await this.syncTopics(user, row.id);
    return row;
  }

  /** Hitung dan catat topik sesuai peran + wilayah rumah (fcm §3.2). */
  async syncTopics(user: User, deviceTokenId: string): Promise<string[]> {
    const topics = await this.desiredTopics(user);
    await this.subscriptions.setTopics(deviceTokenId, topics);
    return topics;
  }

  async desiredTopics(user: User): Promise<string[]> {
    if (user.userType === 'STAFF') {
      return [this.topics.staffAlerts()];
    }
    const result: string[] = [this.topics.city()];
    if (user.homeRegionId) {
      const district = await this.regionLookup.getDistrictForVillage(user.homeRegionId);
      if (district) {
        result.push(this.topics.district(district.code));
      }
    }
    return result;
  }

  async listActive(userId: string): Promise<DeviceToken[]> {
    return this.devices.find({
      where: { userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async revoke(userId: string, deviceId: string): Promise<void> {
    const row = await this.devices.findOne({ where: { id: deviceId, userId } });
    if (!row) throw AppError.notFound();
    await this.subscriptions.clearAll(deviceId);
    await this.devices.update({ id: deviceId }, { revokedAt: this.clock.now() });
  }

  async listActiveTopics(user: User): Promise<string[]> {
    return this.desiredTopics(user);
  }
}
