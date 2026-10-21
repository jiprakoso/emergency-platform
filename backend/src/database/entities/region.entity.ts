import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type RegionLevel = 'CITY' | 'DISTRICT' | 'VILLAGE';

@Entity('regions')
export class Region {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  level!: RegionLevel;

  @Column({ type: 'varchar', length: 20, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'MultiPolygon', srid: 4326, nullable: true })
  boundary!: string | null;

  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  centroid!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
