import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Incident } from './incident.entity';
import { IncidentReport } from './incident-report.entity';
import { User } from './user.entity';

export type AttachmentKind = 'IMAGE' | 'VIDEO' | 'DOCUMENT';
export type AttachmentStatus = 'PENDING' | 'CONFIRMED';

@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'incident_id', type: 'uuid', nullable: true })
  incidentId!: string | null;

  @ManyToOne(() => Incident)
  @JoinColumn({ name: 'incident_id' })
  incident!: Incident | null;

  @Index()
  @Column({ name: 'report_id', type: 'uuid', nullable: true })
  reportId!: string | null;

  @ManyToOne(() => IncidentReport)
  @JoinColumn({ name: 'report_id' })
  report!: IncidentReport | null;

  @Column({ name: 'dispatch_id', type: 'uuid', nullable: true })
  dispatchId!: string | null;

  @Column({ name: 'uploaded_by', type: 'uuid', nullable: true })
  uploadedBy!: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'uploaded_by' })
  uploader!: User | null;

  @Column({ type: 'varchar', length: 10 })
  kind!: AttachmentKind;

  @Column({ type: 'varchar', length: 12, default: 'PENDING' })
  status!: AttachmentStatus;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ name: 'storage_key', type: 'varchar', length: 255 })
  storageKey!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint', nullable: true })
  sizeBytes!: string | null;

  @Column({ type: 'int', nullable: true })
  width!: number | null;

  @Column({ type: 'int', nullable: true })
  height!: number | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
