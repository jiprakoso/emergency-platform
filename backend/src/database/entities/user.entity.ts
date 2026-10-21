import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Region } from './region.entity';

export type UserType = 'CITIZEN' | 'STAFF';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_type', type: 'varchar', length: 16 })
  userType!: UserType;

  @Column({ name: 'full_name', type: 'varchar', length: 150 })
  fullName!: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  phone!: string;

  @Column({ name: 'phone_verified_at', type: 'timestamptz', nullable: true })
  phoneVerifiedAt!: Date | null;

  @Index()
  @Column({ type: 'varchar', length: 150, nullable: true })
  email!: string | null;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash!: string | null;

  @Column({ name: 'two_factor_enabled', type: 'boolean', default: false })
  twoFactorEnabled!: boolean;

  @Column({ name: 'two_factor_secret', type: 'varchar', length: 255, nullable: true, select: false })
  twoFactorSecret!: string | null;

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword!: boolean;

  @Index({ spatial: true })
  @Column({ name: 'home_location', type: 'geography', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  homeLocation!: string | null;

  @Column({ name: 'home_address', type: 'text', nullable: true })
  homeAddress!: string | null;

  @Index()
  @Column({ name: 'home_region_id', type: 'uuid', nullable: true })
  homeRegionId!: string | null;

  @ManyToOne(() => Region)
  @JoinColumn({ name: 'home_region_id' })
  homeRegion!: Region | null;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: UserStatus;

  @Column({ name: 'reputation_score', type: 'smallint', default: 0 })
  reputationScore!: number;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
