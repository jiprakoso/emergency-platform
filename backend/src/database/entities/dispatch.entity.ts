import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Incident } from './incident.entity';
import { Organization } from './organization.entity';
import { ResourceRequest } from './resource-request.entity';
import { Unit } from './unit.entity';
import { User } from './user.entity';

export type DispatchType = 'RESPOND' | 'NOTIFY';
export type DispatchOrigin = 'DISPATCHER' | 'SELF_INITIATED' | 'REQUESTED';
export type DispatchStatus =
  | 'OFFERED'
  | 'ACCEPTED'
  | 'EN_ROUTE'
  | 'ON_SCENE'
  | 'DONE'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'NOTIFIED'
  | 'READY'
  | 'FULL'
  | 'PATIENT_ARRIVED';
export type DispatchOutcome =
  | 'COMPLETED'
  | 'NOT_FOUND'
  | 'HANDED_OVER'
  | 'PATIENT_TRANSPORTED'
  | 'FALSE_ALARM';
export type DispatchChannel = 'APP' | 'PHONE' | 'WHATSAPP' | 'RADIO';

@Entity('dispatches')
@Index(['incidentId'])
@Index(['organizationId', 'status'])
export class Dispatch {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'incident_id', type: 'uuid' })
  incidentId!: string;

  @ManyToOne(() => Incident)
  @JoinColumn({ name: 'incident_id' })
  incident!: Incident;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization;

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId!: string | null;

  @ManyToOne(() => Unit)
  @JoinColumn({ name: 'unit_id' })
  unit!: Unit | null;

  @Column({ type: 'varchar', length: 10 })
  type!: DispatchType;

  @Column({ type: 'varchar', length: 16 })
  origin!: DispatchOrigin;

  @Column({ type: 'varchar', length: 20 })
  status!: DispatchStatus;

  @Column({ type: 'varchar', length: 16, nullable: true })
  channel!: DispatchChannel | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator!: User | null;

  @Column({ name: 'recorded_by', type: 'uuid' })
  recordedBy!: string;

  @Column({ name: 'accepted_by', type: 'uuid', nullable: true })
  acceptedBy!: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'accepted_by' })
  accepter!: User | null;

  @Column({ name: 'resource_request_id', type: 'uuid', nullable: true })
  resourceRequestId!: string | null;

  @ManyToOne(() => ResourceRequest)
  @JoinColumn({ name: 'resource_request_id' })
  resourceRequest!: ResourceRequest | null;

  @Column({ name: 'related_dispatch_id', type: 'uuid', nullable: true })
  relatedDispatchId!: string | null;

  @Column({ name: 'destination_organization_id', type: 'uuid', nullable: true })
  destinationOrganizationId!: string | null;

  @Column({ name: 'offered_at', type: 'timestamptz', nullable: true })
  offeredAt!: Date | null;

  @Column({ name: 'offer_expires_at', type: 'timestamptz', nullable: true })
  offerExpiresAt!: Date | null;

  @Column({ name: 'offer_seen_at', type: 'timestamptz', nullable: true })
  offerSeenAt!: Date | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'en_route_at', type: 'timestamptz', nullable: true })
  enRouteAt!: Date | null;

  @Column({ name: 'on_scene_at', type: 'timestamptz', nullable: true })
  onSceneAt!: Date | null;

  @Column({ name: 'done_at', type: 'timestamptz', nullable: true })
  doneAt!: Date | null;

  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason!: string | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason!: string | null;

  @Column({ name: 'eta_minutes', type: 'int', nullable: true })
  etaMinutes!: number | null;

  @Column({ name: 'distance_m_at_offer', type: 'int', nullable: true })
  distanceMAtOffer!: number | null;

  @Column({ name: 'outcome_code', type: 'varchar', length: 24, nullable: true })
  outcomeCode!: DispatchOutcome | null;

  @Column({ name: 'outcome_note', type: 'text', nullable: true })
  outcomeNote!: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
