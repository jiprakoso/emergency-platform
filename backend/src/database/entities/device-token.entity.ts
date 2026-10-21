import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

export type DevicePlatform = 'ANDROID' | 'IOS' | 'WEB';
export type AppFlavor = 'CITIZEN' | 'STAFF';

@Entity('device_tokens')
export class DeviceToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'fcm_token', type: 'varchar', length: 255, unique: true })
  fcmToken!: string;

  @Column({ type: 'varchar', length: 10 })
  platform!: DevicePlatform;

  @Column({ name: 'app_flavor', type: 'varchar', length: 20 })
  appFlavor!: AppFlavor;

  @Column({ name: 'app_version', type: 'varchar', length: 20, nullable: true })
  appVersion!: string | null;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  @Column({ name: 'push_enabled', type: 'boolean', default: true })
  pushEnabled!: boolean;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
