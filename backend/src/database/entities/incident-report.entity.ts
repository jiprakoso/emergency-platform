import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Incident } from './incident.entity';
import { IncidentType } from './incident-type.entity';
import { User } from './user.entity';

export type ReportKind = 'HELP_REQUEST' | 'CONDITION_REPORT';
export type ReportChannel = 'APP' | 'PHONE' | 'WHATSAPP' | 'SMS';
export type ReportStatus = 'NEW' | 'LINKED' | 'REJECTED' | 'WITHDRAWN';
export type VictimHint = 'UNKNOWN' | 'ONE' | 'TWO' | 'MANY';

@Entity('incident_reports')
export class IncidentReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'incident_id', type: 'uuid', nullable: true })
  incidentId!: string | null;

  @ManyToOne(() => Incident)
  @JoinColumn({ name: 'incident_id' })
  incident!: Incident | null;

  @Column({ name: 'suggested_incident_id', type: 'uuid', nullable: true })
  suggestedIncidentId!: string | null;

  @ManyToOne(() => Incident)
  @JoinColumn({ name: 'suggested_incident_id' })
  suggestedIncident!: Incident | null;

  @Column({ name: 'report_kind', type: 'varchar', length: 20 })
  reportKind!: ReportKind;

  @Column({ name: 'type_id', type: 'uuid' })
  typeId!: string;

  @ManyToOne(() => IncidentType)
  @JoinColumn({ name: 'type_id' })
  type!: IncidentType;

  @Index()
  @Column({ name: 'reporter_id', type: 'uuid', nullable: true })
  reporterId!: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reporter_id' })
  reporter!: User | null;

  @Column({ name: 'reporter_name', type: 'varchar', length: 150, nullable: true })
  reporterName!: string | null;

  @Column({ name: 'reporter_phone', type: 'varchar', length: 20, nullable: true })
  reporterPhone!: string | null;

  @Column({ name: 'entered_by', type: 'uuid', nullable: true })
  enteredBy!: string | null;

  @Column({ type: 'varchar', length: 16 })
  channel!: ReportChannel;

  @Column({ name: 'client_report_id', type: 'uuid', unique: true, nullable: true })
  clientReportId!: string | null;

  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  location!: string;

  @Column({ name: 'location_accuracy_m', type: 'real', nullable: true })
  locationAccuracyM!: number | null;

  @Column({ name: 'address_text', type: 'text', nullable: true })
  addressText!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'victim_hint', type: 'varchar', length: 10, nullable: true })
  victimHint!: VictimHint | null;

  @Column({ type: 'varchar', length: 12 })
  status!: ReportStatus;

  @Column({ type: 'jsonb', nullable: true })
  flags!: Record<string, unknown> | null;

  @Column({ name: 'device_info', type: 'jsonb', nullable: true })
  deviceInfo!: Record<string, unknown> | null;

  @Column({ name: 'occurred_at', type: 'timestamptz', nullable: true })
  occurredAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
