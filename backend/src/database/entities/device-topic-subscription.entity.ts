import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DeviceToken } from './device-token.entity';

export type TopicSubscriptionStatus = 'ACTIVE' | 'REMOVED';

@Entity('device_topic_subscriptions')
export class DeviceTopicSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'device_token_id', type: 'uuid' })
  deviceTokenId!: string;

  @ManyToOne(() => DeviceToken, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_token_id' })
  deviceToken!: DeviceToken;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  topic!: string;

  @Column({ type: 'varchar', length: 12 })
  status!: TopicSubscriptionStatus;

  @Column({ name: 'subscribed_at', type: 'timestamptz' })
  subscribedAt!: Date;

  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt!: Date | null;
}
