import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { IncidentType } from './incident-type.entity';
import { Organization } from './organization.entity';
import { Region } from './region.entity';
import { User } from './user.entity';

export type IncidentStatus =
  | 'SUBMITTED'
  | 'VERIFIED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED'
  | 'INVALID'
  | 'DUPLICATE';
export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'MASS';
export type IncidentSource = 'MOBILE_APP' | 'ADMIN_MANUAL' | 'CALL_CENTER_112';

@Entity('incidents')
@Index(['status', 'createdAt'])
export class Incident {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 24, unique: true })
  code!: string;

  @Column({ name: 'type_id', type: 'uuid' })
  typeId!: string;

  @ManyToOne(() => IncidentType)
  @JoinColumn({ name: 'type_id' })
  type!: IncidentType;

  @Column({ type: 'varchar', length: 16 })
  status!: IncidentStatus;

  @Column({ type: 'varchar', length: 12, nullable: true })
  severity!: IncidentSeverity | null;

  @Column({ name: 'escalation_level', type: 'smallint', nullable: true })
  escalationLevel!: number | null;

  @Column({ type: 'varchar', length: 20 })
  source!: IncidentSource;

  @Column({ name: 'external_ref_id', type: 'varchar', length: 100, nullable: true })
  externalRefId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  summary!: string | null;

  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  location!: string;

  @Column({ name: 'location_accuracy_m', type: 'real', nullable: true })
  locationAccuracyM!: number | null;

  @Column({ name: 'address_text', type: 'text', nullable: true })
  addressText!: string | null;

  @Column({ name: 'district_id', type: 'uuid', nullable: true })
  districtId!: string | null;

  @ManyToOne(() => Region)
  @JoinColumn({ name: 'district_id' })
  district!: Region | null;

  @Column({ name: 'village_id', type: 'uuid', nullable: true })
  villageId!: string | null;

  @ManyToOne(() => Region)
  @JoinColumn({ name: 'village_id' })
  village!: Region | null;

  @Column({ name: 'lead_organization_id', type: 'uuid', nullable: true })
  leadOrganizationId!: string | null;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'lead_organization_id' })
  leadOrganization!: Organization | null;

  @Column({ name: 'lead_set_at', type: 'timestamptz', nullable: true })
  leadSetAt!: Date | null;

  @Column({ name: 'locked_by', type: 'uuid', nullable: true })
  lockedBy!: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'locked_by' })
  lockedByUser!: User | null;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'lock_expires_at', type: 'timestamptz', nullable: true })
  lockExpiresAt!: Date | null;

  @Column({ name: 'verified_by', type: 'uuid', nullable: true })
  verifiedBy!: string | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ name: 'invalid_reason', type: 'text', nullable: true })
  invalidReason!: string | null;

  @Column({ name: 'duplicate_of_id', type: 'uuid', nullable: true })
  duplicateOfId!: string | null;

  @Column({ name: 'disaster_event_id', type: 'uuid', nullable: true })
  disasterEventId!: string | null;

  @Column({ name: 'report_count', type: 'int', default: 0 })
  reportCount!: number;

  @Column({ type: 'jsonb', nullable: true })
  flags!: Record<string, unknown> | null;

  @Column({ name: 'first_reported_at', type: 'timestamptz' })
  firstReportedAt!: Date;

  @Column({ name: 'life_safety_done_at', type: 'timestamptz', nullable: true })
  lifeSafetyDoneAt!: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

