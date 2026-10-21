import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type IncidentCategory =
  | 'TRAFFIC'
  | 'FIRE'
  | 'MEDICAL'
  | 'NATURAL_DISASTER'
  | 'OTHER';

export type LeadOrgType =
  | 'POLICE'
  | 'FIRE'
  | 'BPBD'
  | 'AMBULANCE_SERVICE'
  | 'HOSPITAL'
  | 'OTHER';

@Entity('incident_types')
export class IncidentType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 24 })
  category!: IncidentCategory;

  @Column({ name: 'default_lead_org_type', type: 'varchar', length: 24, nullable: true })
  defaultLeadOrgType!: LeadOrgType | null;

  @Column({ name: 'suggested_resources', type: 'jsonb', nullable: true })
  suggestedResources!: unknown[] | null;

  @Column({ name: 'allows_condition_report', type: 'boolean', default: false })
  allowsConditionReport!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
