import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Dispatch } from './dispatch.entity';
import { User } from './user.entity';

@Entity('dispatch_status_history')
@Index(['dispatchId', 'id'])
export class DispatchStatusHistory {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'dispatch_id', type: 'uuid' })
  dispatchId!: string;

  @ManyToOne(() => Dispatch)
  @JoinColumn({ name: 'dispatch_id' })
  dispatch!: Dispatch;

  @Column({ name: 'from_status', type: 'varchar', length: 20, nullable: true })
  fromStatus!: string | null;

  @Column({ name: 'to_status', type: 'varchar', length: 20 })
  toStatus!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt!: Date;

  @Column({ name: 'recorded_by', type: 'uuid', nullable: true })
  recordedBy!: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'recorded_by' })
  recorder!: User | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  channel!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}
