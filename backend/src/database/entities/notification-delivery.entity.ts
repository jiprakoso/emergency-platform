import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DeviceToken } from './device-token.entity';
import { Notification } from './notification.entity';

export type DeliveryChannel = 'FCM' | 'WEBSOCKET' | 'SMS';
export type DeliveryStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';

@Entity('notification_deliveries')
export class NotificationDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'notification_id', type: 'uuid' })
  notificationId!: string;

  @ManyToOne(() => Notification, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'notification_id' })
  notification!: Notification;

  @Column({ name: 'device_token_id', type: 'uuid', nullable: true })
  deviceTokenId!: string | null;

  @ManyToOne(() => DeviceToken)
  @JoinColumn({ name: 'device_token_id' })
  deviceToken!: DeviceToken | null;

  @Column({ type: 'varchar', length: 10 })
  channel!: DeliveryChannel;

  @Column({ type: 'varchar', length: 12 })
  status!: DeliveryStatus;

  @Column({ type: 'smallint', default: 0 })
  attempts!: number;

  @Column({ name: 'provider_message_id', type: 'varchar', length: 255, nullable: true })
  providerMessageId!: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
