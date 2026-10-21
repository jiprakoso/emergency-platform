import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  DeviceTopicSubscription,
  TopicSubscriptionStatus,
} from '../../database/entities/device-topic-subscription.entity';
import { ClockService } from '../../common/clock/clock.service';

/**
 * Catatan langganan FCM per token (ERD) agar bisa direkonsiliasi tanpa
 * bergantung API pihak ketiga (fcm §3.2). Di sampel, "langganan" hanya dicatat;
 * panggilan FCM nyata menjadi tanggung jawab worker saat kredensial tersedia.
 */
@Injectable()
export class TopicSubscriptionService {
  constructor(
    @InjectRepository(DeviceTopicSubscription)
    private readonly subs: Repository<DeviceTopicSubscription>,
    private readonly clock: ClockService,
  ) {}

  async setTopics(deviceTokenId: string, topics: string[]): Promise<void> {
    const now = this.clock.now();
    const current = await this.subs.find({
      where: { deviceTokenId, status: 'ACTIVE' },
    });
    const desired = new Set(topics);
    const activeTopics = new Set(current.map((c) => c.topic));

    for (const row of current) {
      if (!desired.has(row.topic)) {
        await this.subs.update({ id: row.id }, { status: 'REMOVED', removedAt: now });
      }
    }
    for (const topic of topics) {
      if (!activeTopics.has(topic)) {
        await this.subs.save(
          this.subs.create({
            deviceTokenId,
            topic,
            status: 'ACTIVE' as TopicSubscriptionStatus,
            subscribedAt: now,
            removedAt: null,
          }),
        );
      }
    }
  }

  async clearAll(deviceTokenId: string): Promise<void> {
    const now = this.clock.now();
    await this.subs.update(
      { deviceTokenId, status: 'ACTIVE' },
      { status: 'REMOVED', removedAt: now },
    );
  }

  async activeTopics(deviceTokenId: string): Promise<string[]> {
    const rows = await this.subs.find({
      where: { deviceTokenId, status: 'ACTIVE', removedAt: IsNull() },
    });
    return rows.map((r) => r.topic);
  }
}
