import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type DisasterEventStatus = 'WARNING' | 'RESPONSE' | 'RECOVERY' | 'CLOSED';

@Entity('disaster_events')
export class DisasterEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30, unique: true, nullable: true })
  code!: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  category!: string | null;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  status!: DisasterEventStatus | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  level!: string | null;

  @Column({ type: 'geography', spatialFeatureType: 'MultiPolygon', srid: 4326, nullable: true })
  area!: string | null;

  @Column({ name: 'lead_organization_id', type: 'uuid', nullable: true })
  leadOrganizationId!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  summary!: Record<string, unknown> | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
