import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type OtpPurpose = 'REGISTER' | 'LOGIN' | 'RESET';

@Entity('otp_requests')
export class OtpRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  phone!: string;

  @Column({ name: 'code_hash', type: 'varchar', length: 255, select: false })
  codeHash!: string;

  @Column({ type: 'varchar', length: 16 })
  purpose!: OtpPurpose;

  @Column({ type: 'smallint', default: 0 })
  attempts!: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
