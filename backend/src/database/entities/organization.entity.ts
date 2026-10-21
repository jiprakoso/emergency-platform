import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type OrganizationType =
  | 'COMMAND_CENTER'
  | 'POLICE'
  | 'FIRE'
  | 'HOSPITAL'
  | 'BPBD'
  | 'AMBULANCE_SERVICE'
  | 'PRIVATE_FIRE'
  | 'DISHUB'
  | 'OTHER';

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 24 })
  type!: OrganizationType;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 30, unique: true, nullable: true })
  code!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  location!: string | null;

  @Column({ name: 'service_polygon', type: 'geography', spatialFeatureType: 'MultiPolygon', srid: 4326, nullable: true })
  servicePolygon!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  meta!: Record<string, unknown> | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
