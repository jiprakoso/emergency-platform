import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Incident } from './incident.entity';
import { User } from './user.entity';

@Entity('incident_casualties')
@Index(['incidentId', 'reportedAt'])
export class IncidentCasualty {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'incident_id', type: 'uuid' })
  incidentId!: string;

  @ManyToOne(() => Incident)
  @JoinColumn({ name: 'incident_id' })
  incident!: Incident;

  @Column({ name: 'injured_count', type: 'int', default: 0 })
  injuredCount!: number;

  @Column({ name: 'deceased_count', type: 'int', default: 0 })
  deceasedCount!: number;

  @Column({ name: 'critical_count', type: 'int', nullable: true })
  criticalCount!: number | null;

  @Column({ name: 'missing_count', type: 'int', nullable: true })
  missingCount!: number | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'reported_by', type: 'uuid', nullable: true })
  reportedBy!: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reported_by' })
  reporter!: User | null;

  @Column({ name: 'reported_at', type: 'timestamptz' })
  reportedAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
