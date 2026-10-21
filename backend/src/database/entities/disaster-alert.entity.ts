import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DisasterEvent } from './disaster-event.entity';
import { User } from './user.entity';

export type AlertSource = 'MANUAL' | 'BMKG' | 'BNPB';
export type AlertCategory = 'FLOOD' | 'EARTHQUAKE' | 'WEATHER' | 'LANDSLIDE' | 'OTHER';
export type AlertDeliveryMode = 'REGION_TOPIC' | 'GEOFENCE';
export type AlertStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';

@Entity('disaster_alerts')
export class DisasterAlert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30, unique: true, nullable: true })
  code!: string | null;

  @Column({ type: 'varchar', length: 16 })
  source!: AlertSource;

  @Column({ name: 'external_id', type: 'varchar', length: 100, nullable: true })
  externalId!: string | null;

  @Column({ type: 'varchar', length: 24 })
  category!: AlertCategory;

  @Column({ type: 'varchar', length: 16 })
  level!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'text', nullable: true })
  instruction!: string | null;

  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'MultiPolygon', srid: 4326, nullable: true })
  area!: string | null;

  @Column({ name: 'delivery_mode', type: 'varchar', length: 12 })
  deliveryMode!: AlertDeliveryMode;

  @Index()
  @Column({ type: 'varchar', length: 12 })
  status!: AlertStatus;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator!: User | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'disaster_event_id', type: 'uuid', nullable: true })
  disasterEventId!: string | null;

  @ManyToOne(() => DisasterEvent)
  @JoinColumn({ name: 'disaster_event_id' })
  disasterEvent!: DisasterEvent | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
