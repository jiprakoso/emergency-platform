import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { ClockService } from '../../common/clock/clock.service';
import { redactFields } from '../../common/logger/redact';

/** Konteks HTTP yang ikut dicatat (REST §9, ERD `audit_logs`). */
export type AuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

export type AuditEntry = {
  actorUserId: string | null;
  /** Kode aksi wajib-audit REST §9, mis. `pii.view_reporter`. */
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

/**
 * Kunci yang tidak boleh masuk `before/after` (handoff §11 no. 2): selain daftar
 * redaksi log, nama orang dan teks bebas juga dibuang.
 */
const SENSITIVE_KEYS = new Set(
  [
    ...redactFields.paths.filter((p) => !p.includes('.')),
    'name',
    'fullName',
    'reporterName',
    'reporterPhone',
    'addressText',
    'text',
    'note',
    'reason',
    'secret',
  ].map((k) => k.toLowerCase()),
);

/** Salin data audit dengan kunci sensitif diganti penanda redaksi (rekursif). */
export function maskAuditData(data: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!data) return null;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? redactFields.censor : walk(v);
      }
      return out;
    }
    return value;
  };
  return walk(data) as Record<string, unknown>;
}

/**
 * Satu-satunya penulis `audit_logs` (append-only: hanya INSERT). Pemanggil yang
 * sedang dalam transaksi wajib meneruskan `manager` agar audit ikut commit/rollback.
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>,
    private readonly clock: ClockService,
  ) {}

  async record(entry: AuditEntry, ctx: AuditContext = {}, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLog) : this.logs;
    // `save` (bukan `insert`) karena tipe parsial TypeORM tidak menerima kolom jsonb bertipe Record.
    await repo.save(repo.create({
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeData: maskAuditData(entry.before),
      afterData: maskAuditData(entry.after),
      ipAddress: ctx.ipAddress?.slice(0, 45) ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId?.slice(0, 64) ?? null,
      createdAt: this.clock.now(),
    }));
  }
}
