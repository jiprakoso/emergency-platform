import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Dispatch } from './dispatch.entity';
import { Incident } from './incident.entity';
import { User } from './user.entity';

export type NotificationKind =
  | 'DISPATCH_OFFER'
  | 'INCIDENT_UPDATE'
  | 'ALERT'
  | 'RESOURCE_REQUEST'
  | 'SYSTEM';
export type NotificationPriority = 'HIGH' | 'NORMAL';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 24 })
  kind!: NotificationKind;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar', length: 8, default: 'NORMAL' })
  priority!: NotificationPriority;

  @Column({ name: 'incident_id', type: 'uuid', nullable: true })
  incidentId!: string | null;

  @ManyToOne(() => Incident)
  @JoinColumn({ name: 'incident_id' })
  incident!: Incident | null;

  @Column({ name: 'dispatch_id', type: 'uuid', nullable: true })
  dispatchId!: string | null;

  @ManyToOne(() => Dispatch)
  @JoinColumn({ name: 'dispatch_id' })
  dispatch!: Dispatch | null;

  @Column({ name: 'alert_id', type: 'uuid', nullable: true })
  alertId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  data!: Record<string, unknown> | null;

  @Column({ name: 'seen_at', type: 'timestamptz', nullable: true })
  seenAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
