import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Incident } from '../../database/entities/incident.entity';
import { IncidentEvent } from '../../database/entities/incident-event.entity';
import { OutboxEvent } from '../../database/entities/outbox-event.entity';
import { SystemSetting } from '../../database/entities/system-setting.entity';
import { ClockService } from '../../common/clock/clock.service';
import { AppError } from '../../common/errors/app-error';
import { AuthPrincipal } from '../auth/auth.types';
import { PermissionService } from '../permissions/permission.service';
import { randomUUID } from 'node:crypto';
import { IncidentCasualty } from '../../database/entities/incident-casualty.entity';
import { assertTransition } from './status-engine';
import { AuditContext, AuditService } from '../audit/audit.service';
import { eventSource, IncidentViewLoader } from './incident-view.loader';
import { toEventView } from './incident-views';
import { PageQueryDto } from '../../common/pagination/page-query.dto';
import { ReportViewLoader } from '../reports/report-view.loader';
import { resolveOccurredAt } from '../../common/time/occurred-at';
import type { EventVisibility } from '../../database/entities/incident-event.entity';
import type { IncidentStatus } from '../../database/entities/incident.entity';
import type { EventsQueryDto, IncidentsQueryDto } from './dto/incidents.dto';
import type {
  CasualtyBody,
  CloseBody,
  InvalidateBody,
  LeadBody,
  LockBody,
  MergeBody,
  MilestoneBody,
  NoteBody,
  PatchBody,
  ResolveBody,
  VerifyBody,
} from './dto/incidents.dto';

/** Incident tujuan merge harus masih aktif. */
const MERGE_TARGET_STATUSES: readonly IncidentStatus[] = ['SUBMITTED', 'VERIFIED', 'IN_PROGRESS'];
/** Lead dapat diubah selama incident belum selesai/ditutup. */
const LEAD_EDITABLE_STATUSES: readonly IncidentStatus[] = ['SUBMITTED', 'VERIFIED', 'IN_PROGRESS'];
/** Dispatch yang belum final (REST §6.2/§6.3). */
const ACTIVE_DISPATCH_STATUSES = ['OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE', 'NOTIFIED', 'READY', 'FULL', 'PATIENT_ARRIVED'];
/** A-022: status tujuan saat `resolve` dengan `forceCloseDispatches` — hanya transisi sah §6.2/§6.3. */
const FORCE_CLOSE_TARGET: Record<string, 'CANCELLED' | 'DONE'> = {
  OFFERED: 'CANCELLED',
  ACCEPTED: 'CANCELLED',
  EN_ROUTE: 'CANCELLED',
  ON_SCENE: 'DONE',
  NOTIFIED: 'CANCELLED',
  READY: 'CANCELLED',
  FULL: 'CANCELLED',
  PATIENT_ARRIVED: 'DONE',
};

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    @InjectRepository(IncidentEvent) private readonly incidentEvents: Repository<IncidentEvent>,
    @InjectRepository(OutboxEvent) private readonly outbox: Repository<OutboxEvent>,
    @InjectRepository(SystemSetting) private readonly settings: Repository<SystemSetting>,
    private readonly clock: ClockService,
    private readonly permissions: PermissionService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly views: IncidentViewLoader,
    private readonly reportViews: ReportViewLoader,
  ) {}

  /**
   * Relasi responder ke incident (`incident.read_related`, REST §3): punya dispatch
   * untuk unit/organisasinya, atau organisasinya lead. `accepted` = salah satu
   * dispatch itu sudah melewati tahap offer (batas `OfferView` → `UnitView`).
   */
  private async relationOf(inc: Incident, principal: AuthPrincipal): Promise<{ related: boolean; isLead: boolean; accepted: boolean }> {
    const isLead = !!principal.orgId && inc.leadOrganizationId === principal.orgId;
    const rows: Array<{ status: string }> = await this.dataSource.query(
      `SELECT status FROM dispatches
        WHERE incident_id = $1
          AND (organization_id = $2 OR ($3::uuid IS NOT NULL AND unit_id = $3::uuid))`,
      [inc.id, principal.orgId ?? null, principal.unitId ?? null],
    );
    const accepted = rows.some((r) => ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE', 'DONE'].includes(r.status));
    return { related: isLead || rows.length > 0, isLead, accepted };
  }

  /** `GET /incidents` — antrean dispatcher (IncidentSummary + filter + kursor). */
  list(query: IncidentsQueryDto) {
    return this.views.list(query);
  }

  /**
   * `GET /incidents/{id}` sesuai audiens (REST §4.1): DispatcherView untuk pemegang
   * `incident.read_all`; selain itu OfferView/UnitView dari dispatch milik responder.
   */
  async getById(id: string, principal: AuthPrincipal) {
    if (await this.permissions.hasPermission(principal.userId, 'incident.read_all')) {
      return this.views.dispatcherView(id);
    }
    return this.views.responderView(id, principal);
  }

  private async getLockSeconds(): Promise<number> {
    const row = await this.settings.findOne({ where: { key: 'incident_lock_seconds' } });
    const val = row?.value;
    if (typeof val === 'number') return val;
    if (val && typeof val === 'object' && 'value' in val && typeof val.value === 'number') return val.value;
    return 300;
  }

  /** Baca incident untuk diubah dengan `SELECT … FOR UPDATE` (cegah balapan `version`). */
  private async loadForUpdate(manager: EntityManager, id: string): Promise<Incident> {
    const inc = await manager.getRepository(Incident).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
    return inc;
  }

  /** REST §5.5: aksi dispatcher yang mengubah incident wajib memegang kunci yang masih berlaku. */
  private assertHoldsLock(inc: Incident, userId: string, now: Date): void {
    if (inc.lockedBy !== userId || !inc.lockExpiresAt || inc.lockExpiresAt <= now) {
      throw new AppError('LOCK_REQUIRED', 'Insiden harus dikunci oleh Anda untuk tindakan ini.');
    }
  }

  /** Optimistic locking: `version` klien harus sama dengan versi saat ini (REST §7: `currentVersion`). */
  private assertVersion(inc: Incident, version: number): void {
    if (version !== inc.version) {
      throw new AppError('VERSION_CONFLICT', 'Data telah diubah pihak lain.', undefined, undefined, {
        currentVersion: inc.version,
      });
    }
  }

  /** Satu baris `incident_events` + satu `outbox_events` dalam transaksi pemanggil (AGENTS.md #7). */
  private async recordEvent(
    manager: EntityManager,
    incidentId: string,
    eventType: string,
    actorUserId: string,
    now: Date,
    payload: Record<string, unknown> = {},
    visibility: EventVisibility = 'INTERNAL',
  ): Promise<void> {
    await manager.getRepository(IncidentEvent).save(
      manager.getRepository(IncidentEvent).create({
        incidentId,
        eventType,
        actorUserId,
        visibility,
        occurredAt: now,
        recordedAt: now,
        payload,
      }),
    );
    await manager.getRepository(OutboxEvent).save(
      manager.getRepository(OutboxEvent).create({ eid: randomUUID(), eventType, incidentId, payload: { incidentId }, createdAt: now }),
    );
  }

  /** Organisasi aktif yang ada; selain itu 400 (bukan 500 dari FK). */
  private async assertActiveOrganization(manager: EntityManager, organizationId: string): Promise<void> {
    const rows: unknown[] = await manager.query(`SELECT 1 FROM organizations WHERE id = $1 AND is_active`, [organizationId]);
    if (rows.length === 0) {
      throw AppError.validation('Organisasi tidak ditemukan atau tidak aktif.', [{ field: 'organizationId', issue: 'invalid' }]);
    }
  }

  async lock(id: string, principal: AuthPrincipal, body: LockBody = {}, ctx: AuditContext = {}) {
    const userId = principal.userId;
    const lockSec = await this.getLockSeconds();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + lockSec * 1000);

    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');

    const heldByOther = !!inc.lockedBy && !!inc.lockExpiresAt && inc.lockExpiresAt > now && inc.lockedBy !== userId;
    if (heldByOther) {
      const canOverride = await this.permissions.hasPermission(userId, 'incident.lock_override');
      if (!body.force || !canOverride) {
        throw new AppError('INCIDENT_LOCKED', 'Insiden sedang dikunci oleh pengguna lain.');
      }
    }

    // Kunci = metadata, bukan data incident: `version` tidak dinaikkan, sehingga
    // `version` yang dibaca sebelum mengunci tetap berlaku untuk aksi berikutnya.
    await this.dataSource.transaction(async (manager) => {
      const qb = manager
        .createQueryBuilder()
        .update(Incident)
        .set({ lockedBy: userId, lockedAt: now, lockExpiresAt: expiresAt })
        .where('id = :id', { id });
      if (heldByOther) {
        // Ambil alih hanya dari pemegang yang terlihat tadi (pemegang berganti → ulangi).
        qb.andWhere('locked_by = :prev', { prev: inc.lockedBy });
      } else {
        qb.andWhere('(locked_by IS NULL OR lock_expires_at <= :now OR locked_by = :userId)', { now, userId });
      }
      const res = await qb.execute();
      if (res.affected === 0) {
        throw new AppError('INCIDENT_LOCKED', 'Insiden sedang dikunci oleh pengguna lain.');
      }
      if (heldByOther) {
        await this.audit.record(
          {
            actorUserId: userId,
            action: 'incident.lock_override',
            entityType: 'incident',
            entityId: id,
            before: { lockedBy: inc.lockedBy },
            after: { lockedBy: userId },
          },
          ctx,
          manager,
        );
      }
    });

    return { lockedBy: userId, lockedAt: now.toISOString(), expiresAt: expiresAt.toISOString() };
  }

  async unlock(id: string, principal: AuthPrincipal, ctx: AuditContext = {}) {
    const userId = principal.userId;
    const now = this.clock.now();
    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
    // Tidak terkunci / sudah kedaluwarsa: idempoten.
    if (!inc.lockedBy || !inc.lockExpiresAt || inc.lockExpiresAt <= now) return;

    const releasingOther = inc.lockedBy !== userId;
    if (releasingOther && !(await this.permissions.hasPermission(userId, 'incident.lock_override'))) {
      throw AppError.forbidden('Kunci dipegang pengguna lain.');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .update(Incident)
        .set({ lockedBy: null, lockedAt: null, lockExpiresAt: null })
        .where('id = :id AND locked_by = :holder', { id, holder: inc.lockedBy })
        .execute();
      if (releasingOther) {
        await this.audit.record(
          { actorUserId: userId, action: 'incident.lock_override', entityType: 'incident', entityId: id, before: { lockedBy: inc.lockedBy }, after: { lockedBy: null } },
          ctx,
          manager,
        );
      }
    });
  }

  async renewLock(id: string, principal: AuthPrincipal) {
    const userId = principal.userId;
    const lockSec = await this.getLockSeconds();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + lockSec * 1000);

    // Atomik: hanya pemegang yang kuncinya belum kedaluwarsa (kunci lewat waktu harus diambil ulang).
    const res: unknown = await this.dataSource.query(
      `UPDATE incidents SET lock_expires_at = $4
        WHERE id = $1 AND locked_by = $2 AND lock_expires_at > $3
        RETURNING locked_at`,
      [id, userId, now, expiresAt],
    );
    // Driver pg + UPDATE … RETURNING: TypeORM mengembalikan [baris, jumlah].
    const rows = (Array.isArray(res) && Array.isArray(res[0]) ? res[0] : []) as Array<{ locked_at: Date }>;
    if (rows.length === 0) {
      if (!(await this.incidents.exist({ where: { id } }))) throw AppError.notFound('Insiden tidak ditemukan.');
      throw new AppError('LOCK_REQUIRED', 'Anda harus memegang kunci untuk memperpanjang.');
    }
    return { lockedBy: userId, lockedAt: new Date(rows[0].locked_at).toISOString(), expiresAt: expiresAt.toISOString() };
  }

  async verify(id: string, principal: AuthPrincipal, body: VerifyBody) {
    const userId = principal.userId;
    const now = this.clock.now();
    const updated = await this.dataSource.transaction(async (manager) => {
      const inc = await this.loadForUpdate(manager, id);
      this.assertHoldsLock(inc, userId, now);
      this.assertVersion(inc, body.version);
      assertTransition(inc.status, 'VERIFIED');

      // Lead: dari body, atau otomatis dari `incident_types.default_lead_org_type` (REST §5.5).
      let leadOrganizationId = body.leadOrganizationId ?? null;
      if (leadOrganizationId) {
        await this.assertActiveOrganization(manager, leadOrganizationId);
      } else if (!inc.leadOrganizationId) {
        const rows: Array<{ id: string }> = await manager.query(
          `SELECT o.id FROM incident_types t
             JOIN organizations o ON o.type = t.default_lead_org_type AND o.is_active
            WHERE t.id = $1
            ORDER BY o.created_at, o.id
            LIMIT 1`,
          [inc.typeId],
        );
        leadOrganizationId = rows[0]?.id ?? null;
      }

      inc.status = 'VERIFIED';
      inc.verifiedBy = userId;
      inc.verifiedAt = now;
      inc.severity = body.severity;
      if (leadOrganizationId && leadOrganizationId !== inc.leadOrganizationId) {
        inc.leadOrganizationId = leadOrganizationId;
        inc.leadSetAt = now;
      }
      if (body.summary !== undefined) inc.summary = body.summary;
      inc.version += 1;
      inc.updatedAt = now;
      await manager.getRepository(Incident).save(inc);
      await this.recordEvent(manager, inc.id, 'incident.verified', userId, now, { severity: inc.severity, leadOrganizationId: inc.leadOrganizationId }, 'PUBLIC');
      return inc;
    });
    return this.views.dispatcherView(updated.id);
  }

  async invalidate(id: string, principal: AuthPrincipal, body: InvalidateBody, ctx: AuditContext = {}) {
    const userId = principal.userId;
    const now = this.clock.now();
    const updated = await this.dataSource.transaction(async (manager) => {
      const inc = await this.loadForUpdate(manager, id);
      this.assertHoldsLock(inc, userId, now);
      this.assertVersion(inc, body.version);
      assertTransition(inc.status, 'INVALID');

      const before = { status: inc.status };
      inc.status = 'INVALID';
      inc.invalidReason = body.reason;
      inc.version += 1;
      inc.updatedAt = now;
      await manager.getRepository(Incident).save(inc);
      // REST §5.5: menurunkan reputationScore pelapor (A-021: -1 per pelapor warga berbeda).
      await manager.query(
        `UPDATE users SET reputation_score = GREATEST(reputation_score - 1, -32768), updated_at = $2
          WHERE id IN (SELECT DISTINCT reporter_id FROM incident_reports WHERE incident_id = $1 AND reporter_id IS NOT NULL)
            AND user_type = 'CITIZEN'`,
        [inc.id, now],
      );
      await this.recordEvent(manager, inc.id, 'incident.invalidated', userId, now, { reason: body.reason }, 'PUBLIC');
      await this.audit.record(
        { actorUserId: userId, action: 'incident.invalidate', entityType: 'incident', entityId: inc.id, before, after: { status: inc.status } },
        ctx,
        manager,
      );
      return inc;
    });
    return this.views.dispatcherView(updated.id);
  }

  async merge(id: string, principal: AuthPrincipal, body: MergeBody, ctx: AuditContext = {}) {
    const userId = principal.userId;
    const now = this.clock.now();
    if (body.targetIncidentId === id) {
      throw AppError.validation('Insiden tidak dapat digabung ke dirinya sendiri.', [{ field: 'targetIncidentId', issue: 'invalid' }]);
    }
    const updated = await this.dataSource.transaction(async (manager) => {
      // Kunci baris berurutan id agar dua merge silang tidak deadlock.
      const [first, second] = [id, body.targetIncidentId].sort();
      const locked = new Map<string, Incident>();
      for (const key of [first, second]) {
        const row = await manager.getRepository(Incident).findOne({ where: { id: key }, lock: { mode: 'pessimistic_write' } });
        if (row) locked.set(key, row);
      }
      const inc = locked.get(id);
      if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
      const target = locked.get(body.targetIncidentId);
      if (!target) throw AppError.notFound('Insiden tujuan tidak ditemukan.');

      this.assertHoldsLock(inc, userId, now);
      this.assertVersion(inc, body.version);
      assertTransition(inc.status, 'DUPLICATE');
      if (!MERGE_TARGET_STATUSES.includes(target.status)) {
        throw AppError.conflict('Insiden tujuan tidak aktif.', 'INVALID_STATUS_TRANSITION');
      }

      // ERD §7: semua laporan (dan lampirannya) pindah ke incident tujuan.
      const moved: unknown = await manager.query(
        `UPDATE incident_reports SET incident_id = $2, updated_at = $3 WHERE incident_id = $1 RETURNING id`,
        [inc.id, target.id, now],
      );
      const movedCount = Array.isArray(moved) && Array.isArray(moved[0]) ? (moved[0] as unknown[]).length : 0;
      await manager.query(`UPDATE attachments SET incident_id = $2 WHERE incident_id = $1`, [inc.id, target.id]);

      const before = { status: inc.status, duplicateOfId: inc.duplicateOfId };
      inc.status = 'DUPLICATE';
      inc.duplicateOfId = target.id;
      inc.reportCount = 0;
      inc.version += 1;
      inc.updatedAt = now;
      target.reportCount += movedCount;
      target.version += 1;
      target.updatedAt = now;
      await manager.getRepository(Incident).save([inc, target]);

      await this.recordEvent(manager, inc.id, 'incident.duplicated', userId, now, { targetIncidentId: target.id, movedReports: movedCount });
      await this.audit.record(
        { actorUserId: userId, action: 'incident.merge', entityType: 'incident', entityId: inc.id, before, after: { status: inc.status, duplicateOfId: inc.duplicateOfId } },
        ctx,
        manager,
      );
      return inc;
    });
    return this.views.dispatcherView(updated.id);
  }

  async setLead(id: string, principal: AuthPrincipal, body: LeadBody, ctx: AuditContext = {}) {
    const userId = principal.userId;
    const now = this.clock.now();
    const updated = await this.dataSource.transaction(async (manager) => {
      const inc = await this.loadForUpdate(manager, id);
      this.assertHoldsLock(inc, userId, now);
      if (!LEAD_EDITABLE_STATUSES.includes(inc.status)) {
        throw AppError.conflict('Pemegang komando tidak dapat diubah pada status ini.', 'INVALID_STATUS_TRANSITION');
      }
      await this.assertActiveOrganization(manager, body.organizationId);

      const before = { leadOrganizationId: inc.leadOrganizationId };
      inc.leadOrganizationId = body.organizationId;
      inc.leadSetAt = now;
      inc.version += 1;
      inc.updatedAt = now;
      await manager.getRepository(Incident).save(inc);
      await this.recordEvent(manager, inc.id, 'incident.lead_set', userId, now, { organizationId: body.organizationId, reason: body.reason });
      await this.audit.record(
        { actorUserId: userId, action: 'incident.set_lead', entityType: 'incident', entityId: inc.id, before, after: { leadOrganizationId: inc.leadOrganizationId } },
        ctx,
        manager,
      );
      return inc;
    });
    return this.views.dispatcherView(updated.id);
  }

  async resolve(id: string, principal: AuthPrincipal, body: ResolveBody) {
    const userId = principal.userId;
    const now = this.clock.now();
    const updated = await this.dataSource.transaction(async (manager) => {
      const inc = await this.loadForUpdate(manager, id);
      this.assertHoldsLock(inc, userId, now);
      this.assertVersion(inc, body.version);
      assertTransition(inc.status, 'RESOLVED');

      const active: Array<{ id: string; status: string }> = await manager.query(
        `SELECT id, status FROM dispatches WHERE incident_id = $1 AND status = ANY($2::text[]) FOR UPDATE`,
        [inc.id, ACTIVE_DISPATCH_STATUSES],
      );
      if (active.length > 0 && !body.forceCloseDispatches) {
        throw AppError.conflict('Masih ada dispatch aktif.', 'ACTIVE_DISPATCHES_EXIST');
      }
      // A-022: tutup paksa lewat transisi sah §6.2/§6.3 — CANCELLED bila tersedia, selain itu DONE.
      for (const d of active) {
        const toStatus = FORCE_CLOSE_TARGET[d.status];
        await manager.query(
          `UPDATE dispatches SET status = $2::varchar,
                  cancel_reason = CASE WHEN $2::varchar = 'CANCELLED' THEN 'Incident diselesaikan dispatcher' ELSE cancel_reason END,
                  done_at = CASE WHEN $2::varchar = 'DONE' THEN $3::timestamptz ELSE done_at END,
                  version = version + 1, updated_at = $3::timestamptz
            WHERE id = $1`,
          [d.id, toStatus, now],
        );
      }

      inc.status = 'RESOLVED';
      inc.resolvedAt = now;
      inc.version += 1;
      inc.updatedAt = now;
      await manager.getRepository(Incident).save(inc);
      await this.recordEvent(manager, inc.id, 'incident.resolved', userId, now, { resolutionNote: body.note, closedDispatches: active.length }, 'PUBLIC');
      return inc;
    });
    return this.views.dispatcherView(updated.id);
  }

  async close(id: string, principal: AuthPrincipal, body: CloseBody) {
    const userId = principal.userId;
    const now = this.clock.now();
    const updated = await this.dataSource.transaction(async (manager) => {
      const inc = await this.loadForUpdate(manager, id);
      this.assertHoldsLock(inc, userId, now);
      this.assertVersion(inc, body.version);
      assertTransition(inc.status, 'CLOSED');
      inc.status = 'CLOSED';
      inc.closedAt = now;
      inc.version += 1;
      inc.updatedAt = now;
      await manager.getRepository(Incident).save(inc);
      await this.recordEvent(manager, inc.id, 'incident.closed', userId, now, { resolutionNote: body.note });
      return inc;
    });
    return this.views.dispatcherView(updated.id);
  }

  nearby(id: string, radiusM: number, hours: number) {
    return this.views.nearby(id, radiusM, hours);
  }

  async patch(id: string, principal: AuthPrincipal, body: PatchBody) {
    const userId = principal.userId;
    const now = this.clock.now();
    const updated = await this.dataSource.transaction(async (manager) => {
      const inc = await this.loadForUpdate(manager, id);
      this.assertHoldsLock(inc, userId, now);
      this.assertVersion(inc, body.version);
      if (!LEAD_EDITABLE_STATUSES.includes(inc.status)) {
        throw AppError.conflict('Insiden yang sudah selesai tidak dapat diubah.', 'INVALID_STATUS_TRANSITION');
      }

      const changed: string[] = [];
      if (body.typeCode !== undefined) {
        const rows: Array<{ id: string }> = await manager.query(`SELECT id FROM incident_types WHERE code = $1 AND is_active`, [body.typeCode]);
        if (!rows[0]) throw AppError.validation('Tipe kejadian tidak valid.', [{ field: 'typeCode', issue: 'invalid' }]);
        inc.typeId = rows[0].id;
        changed.push('typeCode');
      }
      if (body.severity !== undefined) (inc.severity = body.severity), changed.push('severity');
      if (body.escalationLevel !== undefined) (inc.escalationLevel = body.escalationLevel), changed.push('escalationLevel');
      if (body.summary !== undefined) (inc.summary = body.summary), changed.push('summary');
      if (body.addressText !== undefined) (inc.addressText = body.addressText), changed.push('addressText');
      inc.version += 1;
      inc.updatedAt = now;
      await manager.getRepository(Incident).save(inc);
      if (body.location) {
        // Koordinat API {lat,lng} → PostGIS (lng,lat); hanya di lapisan data (AGENTS.md konvensi).
        await manager.query(
          `UPDATE incidents SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, location_accuracy_m = $4 WHERE id = $1`,
          [inc.id, body.location.lng, body.location.lat, body.location.accuracyM ?? null],
        );
        changed.push('location');
      }
      // Payload event hanya nama field (nilai seperti lokasi/alamat tidak disalin ke log event).
      await this.recordEvent(manager, inc.id, 'incident.updated', userId, now, { fields: changed });
      return inc;
    });
    return this.views.dispatcherView(updated.id);
  }

  /** Dispatcher: semua event; responder terkait: `UNITS`/`PUBLIC` (+`LEAD` bila lead). */
  async getEvents(id: string, principal: AuthPrincipal, query: EventsQueryDto) {
    let visibilities: EventVisibility[] | null = null;
    if (!(await this.permissions.hasPermission(principal.userId, 'incident.read_all'))) {
      const inc = await this.incidents.findOne({ where: { id } });
      if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
      const relation = await this.relationOf(inc, principal);
      if (!relation.related) throw AppError.notFound('Insiden tidak ditemukan.');
      visibilities = relation.isLead ? ['UNITS', 'PUBLIC', 'LEAD'] : ['UNITS', 'PUBLIC'];
    }
    return this.views.events(id, visibilities, { afterId: query.afterId, limit: query.limit });
  }

  /** `GET /incidents/{id}/reports`: CitizenReportView tertaut (tanpa kontak pelapor). */
  async getReports(id: string, query: PageQueryDto) {
    if (!(await this.incidents.exist({ where: { id } }))) throw AppError.notFound('Insiden tidak ditemukan.');
    return this.reportViews.forIncident(id, { limit: query.limit, cursor: query.cursor });
  }

  async addNote(id: string, principal: AuthPrincipal, body: NoteBody) {
    const userId = principal.userId;
    const now = this.clock.now();
    if (!(await this.incidents.exist({ where: { id } }))) throw AppError.notFound('Insiden tidak ditemukan.');
    const eventId = await this.dataSource.transaction(async (manager) => {
      const evRepo = manager.getRepository(IncidentEvent);
      // REST §5.5: catatan hanya INTERNAL/LEAD/UNITS (divalidasi DTO) — tidak pernah PUBLIC.
      const ev = await evRepo.save(
        evRepo.create({ incidentId: id, eventType: 'incident.note_added', actorUserId: userId, visibility: body.visibility, occurredAt: now, recordedAt: now, payload: { text: body.text } }),
      );
      await manager.getRepository(OutboxEvent).save(
        manager.getRepository(OutboxEvent).create({ eid: randomUUID(), eventType: 'incident.note_added', incidentId: id, payload: { incidentId: id }, createdAt: now }),
      );
      return String(ev.id);
    });
    return this.eventView(eventId);
  }

  /** Satu IncidentEventView (respons catatan/milestone) dengan `actorName` dari akun. */
  private async eventView(eventId: string) {
    const [row] = await this.dataSource.query(
      `SELECT e.id::text AS id, e.event_type, e.occurred_at, u.full_name AS actor_name, e.channel, e.payload, e.visibility
         FROM incident_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.id = $1`,
      [eventId],
    );
    return toEventView(eventSource(row), { includeActor: true });
  }

  /**
   * REST §5.5: setiap pembaruan menambah baris riwayat `incident_casualties`.
   * Dispatcher wajib memegang kunci; responder tanpa kunci tetapi harus terkait incident.
   */
  async addCasualty(id: string, principal: AuthPrincipal, body: CasualtyBody) {
    const userId = principal.userId;
    const now = this.clock.now();
    const isDispatcher = await this.permissions.hasPermission(userId, 'incident.read_all');
    return this.dataSource.transaction(async (manager) => {
      const inc = await this.loadForUpdate(manager, id);
      if (isDispatcher) {
        this.assertHoldsLock(inc, userId, now);
      } else if (!(await this.relationOf(inc, principal)).related) {
        throw AppError.notFound('Insiden tidak ditemukan.');
      }
      const casRepo = manager.getRepository(IncidentCasualty);
      const casualty = await casRepo.save(
        casRepo.create({
          incidentId: id,
          injuredCount: body.injured,
          deceasedCount: body.deceased,
          criticalCount: body.critical ?? null,
          missingCount: body.missing ?? null,
          note: body.note ?? null,
          reportedBy: userId,
          reportedAt: now,
          createdAt: now,
        }),
      );
      await this.recordEvent(manager, id, 'incident.casualties_updated', userId, now, {
        injured: body.injured,
        deceased: body.deceased,
        critical: body.critical ?? null,
        missing: body.missing ?? null,
      });
      return {
        id: casualty.id,
        injured: casualty.injuredCount,
        deceased: casualty.deceasedCount,
        critical: casualty.criticalCount,
        missing: casualty.missingCount,
        note: casualty.note,
        reportedAt: casualty.reportedAt.toISOString(),
      };
    });
  }

  async addMilestone(id: string, principal: AuthPrincipal, body: MilestoneBody) {
    const userId = principal.userId;
    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
    // Responder hanya bila organisasinya lead (REST §3 pembatas `lead`; S1 langkah 7).
    const isDispatcher = await this.permissions.hasPermission(userId, 'incident.read_all');
    if (!isDispatcher) {
      const relation = await this.relationOf(inc, principal);
      if (!relation.related) throw AppError.notFound('Insiden tidak ditemukan.');
      if (!relation.isLead) throw new AppError('NOT_LEAD_ORGANIZATION', 'Hanya organisasi pemegang komando yang dapat mencatat milestone.');
    }
    const now = this.clock.now();
    // REST §1.5: maks 5 menit ke depan; >24 jam ke belakang hanya dispatcher/supervisor.
    const occurredAt = resolveOccurredAt(now, body.occurredAt ? new Date(body.occurredAt) : undefined, isDispatcher);
    const eventId = await this.dataSource.transaction(async (manager) => {
      const evRepo = manager.getRepository(IncidentEvent);
      // A-026: milestone adalah koordinasi lapangan → terlihat unit terkait (`UNITS`).
      const ev = await evRepo.save(
        evRepo.create({ incidentId: id, eventType: 'incident.milestone', actorUserId: userId, visibility: 'UNITS', occurredAt, recordedAt: now, payload: { ...body.payload, code: body.code, note: body.note } }),
      );
      await manager.getRepository(OutboxEvent).save(
        manager.getRepository(OutboxEvent).create({ eid: randomUUID(), eventType: 'incident.milestone', incidentId: id, payload: { incidentId: id, code: body.code }, createdAt: now }),
      );
      return String(ev.id);
    });
    return this.eventView(eventId);
  }

  async getDispatchRecommendations(id: string) {
    const inc = await this.incidents.findOne({ where: { id }, relations: ['type', 'district', 'village', 'leadOrganization'] });
    if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');

    // Build recommendations based on incident type and location
    const recommendations = [];

    // Always recommend the lead organization if set
    if (inc.leadOrganization) {
      recommendations.push({
        organization: {
          id: inc.leadOrganization.id,
          name: inc.leadOrganization.name,
          type: inc.leadOrganization.type || 'ORGANIZATION',
        },
        dispatchType: 'NOTIFY' as const,
        required: false,
        alreadyDispatched: false,
      });
    }

    // Add type-specific recommendations
    const typeCode = inc.type?.code || '';
    if (typeCode.includes('FIRE') || typeCode.includes('KB')) {
      // Fire/kemacauan incidents -> fire department
      recommendations.push({
        organization: {
          id: 'fire-dept-example',
          name: 'Dinas Pemadam Kebakaran Kota Contoh',
          type: 'FIRE',
        },
        dispatchType: 'RESPOND' as const,
        required: true,
        alreadyDispatched: false,
      });
    }
    if (typeCode.includes('ACC') || typeCode.includes('ACCIDENT') || typeCode.includes('LELA') || typeCode.includes('TRAFFIC')) {
      // Traffic accidents -> ambulance + police
      recommendations.push({
        organization: {
          id: 'ambulance-example',
          name: 'Layanan Ambulans Kota Contoh',
          type: 'AMBULANCE_SERVICE',
        },
        dispatchType: 'RESPOND' as const,
        required: true,
        alreadyDispatched: false,
      });
      recommendations.push({
        organization: {
          id: 'police-example',
          name: 'Polres Kota Contoh',
          type: 'POLICE',
        },
        dispatchType: 'RESPOND' as const,
        required: true,
        alreadyDispatched: false,
      });
    }
    if (typeCode.includes('FLOOD') || typeCode.includes('BA')) {
      // Flood -> BPBD
      recommendations.push({
        organization: {
          id: 'bpbd-example',
          name: 'BPBD Kota Contoh',
          type: 'BPBD',
        },
        dispatchType: 'RESPOND' as const,
        required: true,
        alreadyDispatched: false,
      });
    }

    // If no specific recommendations, add general ones based on available seed data
    if (recommendations.length === 0) {
      recommendations.push({
        organization: {
          id: 'ambulance-example',
          name: 'Layanan Ambulans Kota Contoh',
          type: 'AMBULANCE_SERVICE',
        },
        dispatchType: 'RESPOND' as const,
        required: true,
        alreadyDispatched: false,
      });
      recommendations.push({
        organization: {
          id: 'police-example',
          name: 'Polres Kota Contoh',
          type: 'POLICE',
        },
        dispatchType: 'RESPOND' as const,
        required: true,
        alreadyDispatched: false,
      });
      recommendations.push({
        organization: {
          id: 'fire-example',
          name: 'Dinas Pemadam Kebakaran Kota Contoh',
          type: 'FIRE',
        },
        dispatchType: 'RESPOND' as const,
        required: false,
        alreadyDispatched: false,
      });
    }

    return { data: recommendations };
  }
}
