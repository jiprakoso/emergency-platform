import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DeviceToken } from './device-token.entity';
import { User } from './user.entity';

@Entity('auth_sessions')
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'device_token_id', type: 'uuid', nullable: true })
  deviceTokenId!: string | null;

  @ManyToOne(() => DeviceToken)
  @JoinColumn({ name: 'device_token_id' })
  deviceToken!: DeviceToken | null;

  @Column({ name: 'refresh_token_hash', type: 'varchar', length: 255, select: false })
  refreshTokenHash!: string;

  @Column({ name: 'previous_token_hash', type: 'varchar', length: 255, nullable: true, select: false })
  previousTokenHash!: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  platform!: string | null;

  @Column({ name: 'app_flavor', type: 'varchar', length: 20, nullable: true })
  appFlavor!: string | null;

  @Column({ name: 'app_version', type: 'varchar', length: 20, nullable: true })
  appVersion!: string | null;

  @Index()
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
