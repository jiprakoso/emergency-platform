import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Organization } from './organization.entity';

export type UnitType = 'AMBULANCE' | 'FIRE_ENGINE' | 'RESCUE_TEAM' | 'ER' | 'PATROL' | 'OTHER';
export type UnitStatus = 'AVAILABLE' | 'BUSY' | 'OFFLINE' | 'OUT_OF_SERVICE';

@Entity('units')
@Index(['organizationId', 'status'])
export class Unit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'unit_type', type: 'varchar', length: 24 })
  unitType!: UnitType;

  @Column({ name: 'plate_number', type: 'varchar', length: 15, nullable: true })
  plateNumber!: string | null;

  @Column({ type: 'varchar', length: 16 })
  status!: UnitStatus;

  @Index({ spatial: true })
  @Column({ name: 'last_location', type: 'geography', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  lastLocation!: string | null;

  @Column({ name: 'last_location_at', type: 'timestamptz', nullable: true })
  lastLocationAt!: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  meta!: Record<string, unknown> | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
