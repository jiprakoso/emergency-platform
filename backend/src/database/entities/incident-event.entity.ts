import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Dispatch } from './dispatch.entity';
import { Incident } from './incident.entity';
import { Organization } from './organization.entity';
import { User } from './user.entity';

export type EventVisibility = 'INTERNAL' | 'LEAD' | 'UNITS' | 'PUBLIC';

@Entity('incident_events')
@Index(['incidentId', 'id'])
export class IncidentEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'incident_id', type: 'uuid' })
  incidentId!: string;

  @ManyToOne(() => Incident)
  @JoinColumn({ name: 'incident_id' })
  incident!: Incident;

  @Column({ name: 'dispatch_id', type: 'uuid', nullable: true })
  dispatchId!: string | null;

  @ManyToOne(() => Dispatch)
  @JoinColumn({ name: 'dispatch_id' })
  dispatch!: Dispatch | null;

  @Index()
  @Column({ name: 'event_type', type: 'varchar', length: 40 })
  eventType!: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'actor_user_id' })
  actorUser!: User | null;

  @Column({ name: 'actor_organization_id', type: 'uuid', nullable: true })
  actorOrganizationId!: string | null;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'actor_organization_id' })
  actorOrganization!: Organization | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  channel!: string | null;

  @Column({ type: 'varchar', length: 10 })
  visibility!: EventVisibility;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt!: Date;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;
}
