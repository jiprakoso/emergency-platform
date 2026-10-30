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
import { IncidentReport } from '../../database/entities/incident-report.entity';
import { IncidentCasualty } from '../../database/entities/incident-casualty.entity';
import { resolvePublicStatus } from './resolve-public-status';
import { assertTransition } from './status-engine';
import { AuditContext, AuditService } from '../audit/audit.service';
import type { EventVisibility } from '../../database/entities/incident-event.entity';
import type { IncidentStatus } from '../../database/entities/incident.entity';
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

const NOTE_VISIBILITIES: readonly EventVisibility[] = ['INTERNAL', 'LEAD', 'UNITS'];
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

  /** geography (driver PostGIS) → {lat, lng} tanpa `any`. */
  private coords(raw: string): { lat: number | undefined; lng: number | undefined } {
    const point = raw as unknown as { coordinates?: [number, number] };
    return { lat: point.coordinates?.[1], lng: point.coordinates?.[0] };
  }

  async list() {
    const list = await this.incidents.find({ order: { createdAt: 'DESC' }, take: 25 });
    const data = list.map((i) => ({
      id: i.id,
      code: i.code,
      status: i.status,
      severity: i.severity,
      createdAt: i.createdAt,
    }));
    return { data, page: { hasMore: false, limit: 25 } };
  }

  async getById(id: string, principal: AuthPrincipal) {
    const inc = await this.incidents.findOne({ where: { id }, relations: ['type', 'district', 'village', 'leadOrganization'] });
    if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
    const canReadAll = await this.permissions.hasPermission(principal.userId, 'incident.read_all');
    // Responder tanpa relasi: 404, bukan 403, agar keberadaan incident tidak bocor.
    const relation = canReadAll ? null : await this.relationOf(inc, principal);
    if (relation && !relation.related) throw AppError.notFound('Insiden tidak ditemukan.');

    // Calculate publicStatus using the status engine
    const publicStatus = await resolvePublicStatus(this.dataSource, inc.id);

    // Query casualties - get the latest casualty record
    const casualtyRepo = this.incidents.manager.getRepository('IncidentCasualty');
    const casualty = await casualtyRepo.findOne({ where: { incidentId: inc.id }, order: { reportedAt: 'DESC' } });

    // Query dispatches - get all dispatches for this incident
    const dispatchRepo = this.incidents.manager.getRepository('Dispatch');
    const dispatches = await dispatchRepo.find({ where: { incidentId: inc.id } });

    if (canReadAll) {
      // Full DispatcherViewIncident shape
      const dispatchList = dispatches.map(d => ({
        organization: d.leadOrganization ? { id: d.leadOrganization.id, name: d.leadOrganization.name } : undefined,
        unit: d.unit ? { id: d.unit.id, name: d.unit.name, status: d.status } : undefined,
        status: d.status,
        type: d.type,
      }));
      const casualtyData = casualty ? {
        injured: casualty.injuredCount,
        deceased: casualty.deceasedCount,
        critical: casualty.criticalCount,
        missing: casualty.missingCount,
      } : null;
      return {
        id: inc.id,
        code: inc.code,
        type: inc.type ? { code: inc.type.code, name: inc.type.name } : undefined,
        status: inc.status,
        publicStatus: publicStatus,
        severity: inc.severity,
        escalationLevel: inc.escalationLevel,
        district: inc.district ? { code: inc.district.code, name: inc.district.name } : undefined,
        village: inc.village ? { code: inc.village.code, name: inc.village.name } : undefined,
        location: inc.location ? this.coords(inc.location) : undefined,
        addressText: inc.addressText,
        summary: inc.summary,
        leadOrganization: inc.leadOrganization ? { id: inc.leadOrganization.id, name: inc.leadOrganization.name } : undefined,
        reporter: { name: null, phoneMasked: null },
        attachments: [],
        casualties: casualtyData,
        dispatches: dispatchList,
        lockedBy: inc.lockedBy,
        lockedAt: inc.lockedAt?.toISOString() ?? null,
        version: inc.version,
        createdAt: inc.createdAt,
        updatedAt: inc.updatedAt,
      };
    }
    // Responder: lokasi presisi, alamat, lampiran, pelapor tidak pernah dikirim di sini.
    // Sebelum accept (OfferView §4.1) dispatch unit lain dan data korban juga disembunyikan.
    const showOperational = relation!.accepted || relation!.isLead;
    const casualtyData = casualty ? {
      injured: casualty.injuredCount,
      deceased: casualty.deceasedCount,
      critical: casualty.criticalCount,
      missing: casualty.missingCount,
    } : null;
    const dispatchList = dispatches.map(d => ({
      organization: d.leadOrganization ? { id: d.leadOrganization.id, name: d.leadOrganization.name } : undefined,
      unit: d.unit ? { id: d.unit.id, name: d.unit.name, status: d.status } : undefined,
      status: d.status,
      type: d.type,
    }));
    return {
      id: inc.id,
      code: inc.code,
      type: inc.type ? { code: inc.type.code, name: inc.type.name } : undefined,
      status: inc.status,
      publicStatus: publicStatus,
      severity: inc.severity,
      escalationLevel: inc.escalationLevel,
      district: inc.district ? { code: inc.district.code, name: inc.district.name } : undefined,
      village: inc.village ? { code: inc.village.code, name: inc.village.name } : undefined,
      // Location NOT visible to responders who haven't accepted
      addressText: undefined,
      summary: undefined,
      leadOrganization: inc.leadOrganization ? { id: inc.leadOrganization.id, name: inc.leadOrganization.name } : undefined,
      reporter: { name: null, phoneMasked: null },
      attachments: [],
      casualties: showOperational ? casualtyData : null,
      dispatches: showOperational ? dispatchList : [],
    };
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
  ): Promise<void> {
    await manager.getRepository(IncidentEvent).save(
      manager.getRepository(IncidentEvent).create({
        incidentId,
        eventType,
        actorUserId,
        visibility: 'INTERNAL',
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
    return this.dataSource.transaction(async (manager) => {
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
      await this.recordEvent(manager, inc.id, 'incident.verified', userId, now, { severity: inc.severity, leadOrganizationId: inc.leadOrganizationId });
      return inc;
    });
  }

  async invalidate(id: string, principal: AuthPrincipal, body: InvalidateBody, ctx: AuditContext = {}) {
    const userId = principal.userId;
    const now = this.clock.now();
    return this.dataSource.transaction(async (manager) => {
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
      await this.recordEvent(manager, inc.id, 'incident.invalidated', userId, now, { reason: body.reason });
      await this.audit.record(
        { actorUserId: userId, action: 'incident.invalidate', entityType: 'incident', entityId: inc.id, before, after: { status: inc.status } },
        ctx,
        manager,
      );
      return inc;
    });
  }

  async merge(id: string, principal: AuthPrincipal, body: MergeBody, ctx: AuditContext = {}) {
    const userId = principal.userId;
    const now = this.clock.now();
    if (body.targetIncidentId === id) {
      throw AppError.validation('Insiden tidak dapat digabung ke dirinya sendiri.', [{ field: 'targetIncidentId', issue: 'invalid' }]);
    }
    return this.dataSource.transaction(async (manager) => {
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
  }

  async setLead(id: string, principal: AuthPrincipal, body: LeadBody, ctx: AuditContext = {}) {
    const userId = principal.userId;
    const now = this.clock.now();
    return this.dataSource.transaction(async (manager) => {
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
  }

  async resolve(id: string, principal: AuthPrincipal, body: ResolveBody) {
    const userId = principal.userId;
    const now = this.clock.now();
    return this.dataSource.transaction(async (manager) => {
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
      await this.recordEvent(manager, inc.id, 'incident.resolved', userId, now, { note: body.note, closedDispatches: active.length });
      return inc;
    });
  }

  async close(id: string, principal: AuthPrincipal, body: CloseBody) {
    const userId = principal.userId;
    const now = this.clock.now();
    return this.dataSource.transaction(async (manager) => {
      const inc = await this.loadForUpdate(manager, id);
      this.assertHoldsLock(inc, userId, now);
      this.assertVersion(inc, body.version);
      assertTransition(inc.status, 'CLOSED');
      inc.status = 'CLOSED';
      inc.closedAt = now;
      inc.version += 1;
      inc.updatedAt = now;
      await manager.getRepository(Incident).save(inc);
      await this.recordEvent(manager, inc.id, 'incident.closed', userId, now, { note: body.note });
      return inc;
    });
  }

  async nearby(id: string, radiusM = 300, hours = 6) {
    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
    try {
      const rows = await this.incidents.query(
        `SELECT id, code, ST_Distance(location::geography, (SELECT location FROM incidents WHERE id = $1)::geography) AS dist_m, created_at
         FROM incidents
         WHERE id <> $1
           AND location IS NOT NULL
           AND created_at >= (now() - interval '1 hour' * $2)
           AND ST_Distance(location::geography, (SELECT location FROM incidents WHERE id = $1)::geography) <= $3
         ORDER BY dist_m ASC
         LIMIT 50`,
        [id, hours, radiusM],
      );
      const data = rows.map((r: { id: string; code: string; dist_m: string | number; created_at: Date }) => ({
        id: r.id,
        code: r.code,
        distanceM: Math.round(Number(r.dist_m)),
        createdAt: r.created_at,
      }));
      return { data };
    } catch (e) {
      return { data: [] };
    }
  }

  async patch(id: string, principal: AuthPrincipal, body: PatchBody) {
    const userId = principal.userId;
    const now = this.clock.now();
    return this.dataSource.transaction(async (manager) => {
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
  }

  async getEvents(id: string, principal?: AuthPrincipal) {
    const events = await this.incidentEvents.find({ where: { incidentId: id }, order: { id: 'ASC' }, take: 100 });
    let data = events.map((e) => ({ id: String(e.id), type: e.eventType, occurredAt: e.occurredAt?.toISOString(),      visibility: e.visibility, actorName: e.actorUserId || undefined, channel: e.channel, note: e.payload?.note || e.payload?.description || undefined }));
    // Filter by visibility according to role
    if (principal?.userId) {
      const userId = principal.userId;
      const canReadAll = await this.permissions.hasPermission(userId, 'incident.read_all').catch(() => false);
      if (canReadAll || principal.roles?.includes('DISPATCHER') || principal.roles?.includes('SUPERVISOR') || principal.roles?.includes('ADMIN')) {
        // Dispatcher/admin see all events (tanpa penyaringan)
      } else {
        // Responder see only INTERNAL events, not PUBLIC
        data = data.filter((e) => e.visibility !== 'PUBLIC');
      }
    }
    return { data, page: { hasMore: false, limit: 100 } };
  }

  async getReports(id: string, principal?: AuthPrincipal) {
    const reportsRepo = this.incidents.manager.getRepository(IncidentReport);
    const reports = await reportsRepo.find({ where: { incidentId: id }, order: { createdAt: 'ASC' }, take: 50 });
    let data = reports.map((r) => ({
      id: r.id,
      reportKind: r.reportKind,
      status: r.status,
      location: r.location ? this.coords(r.location) : undefined,
      addressText: r.addressText,
      description: r.description,
      createdAt: r.createdAt,
      reporter: { name: null, phoneMasked: null }, // masked
    }));
    // Filter by reporter ownership for warga
    if (principal?.userId) {
      const userId = principal.userId;
      const canReadAll = await this.permissions.hasPermission(userId, 'incident.read_all').catch(() => false);
      if (canReadAll || principal.roles?.includes('DISPATCHER') || principal.roles?.includes('SUPERVISOR') || principal.roles?.includes('ADMIN')) {
        // Dispatcher/admin see all reports (tanpa penyaringan)
      } else {
        // Warga see only their own reports (reporterId matches)
        // For now, filter out reports without a known reporter (masked)
        data = data.filter((r) => r.reporter.name !== null || r.reportKind !== 'HELP_REQUEST');
      }
    }
    return { data, page: { hasMore: false, limit: 50 } };
  }

  async addNote(id: string, principal: AuthPrincipal | undefined, body?: NoteBody) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const can = await this.permissions.hasPermission(userId, 'note.create');
    if (!can) throw AppError.forbidden();
    const now = this.clock.now();
    // REST §5.5: catatan hanya INTERNAL/LEAD/UNITS — tidak pernah PUBLIC (timeline warga).
    const visibility: EventVisibility = body?.visibility ?? 'INTERNAL';
    if (!NOTE_VISIBILITIES.includes(visibility)) {
      throw AppError.validation('visibility catatan harus INTERNAL, LEAD, atau UNITS.', [{ field: 'visibility', issue: 'invalid' }]);
    }
    if (!(await this.incidents.exist({ where: { id } }))) throw AppError.notFound('Insiden tidak ditemukan.');
    const result = await this.incidents.manager.transaction(async (manager) => {
      const evRepo = manager.getRepository(IncidentEvent);
      const outRepo = manager.getRepository(OutboxEvent);
      const ev = await evRepo.save(evRepo.create({ incidentId: id, eventType: 'incident.note_added', actorUserId: userId, visibility, occurredAt: now, recordedAt: now, payload: { text: body?.text } }));
      await outRepo.save(outRepo.create({ eid: randomUUID(), eventType: 'incident.note_added', incidentId: id, payload: { incidentId: id }, createdAt: now }));
      return { id: String(ev.id), type: ev.eventType, occurredAt: ev.occurredAt?.toISOString(), actorName: userId, note: body?.text };
    });
    return result;
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

  async addMilestone(id: string, principal: AuthPrincipal | undefined, body?: MilestoneBody) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const can = await this.permissions.hasPermission(userId, 'milestone.create');
    if (!can) throw AppError.forbidden();
    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
    // Responder hanya bila organisasinya lead (REST §3 pembatas `lead`; S1 langkah 7).
    if (!(await this.permissions.hasPermission(userId, 'incident.read_all'))) {
      const relation = await this.relationOf(inc, principal!);
      if (!relation.related) throw AppError.notFound('Insiden tidak ditemukan.');
      if (!relation.isLead) throw new AppError('NOT_LEAD_ORGANIZATION', 'Hanya organisasi pemegang komando yang dapat mencatat milestone.');
    }
    const now = this.clock.now();
    const result = await this.incidents.manager.transaction(async (manager) => {
      const evRepo = manager.getRepository(IncidentEvent);
      const outRepo = manager.getRepository(OutboxEvent);
      const ev = await evRepo.save(evRepo.create({ incidentId: id, eventType: 'incident.milestone', actorUserId: userId, visibility: 'INTERNAL', occurredAt: body?.occurredAt ? new Date(body.occurredAt) : now, recordedAt: now, payload: { code: body?.code, note: body?.note, ...body?.payload } }));
      await outRepo.save(outRepo.create({ eid: randomUUID(), eventType: 'incident.milestone', incidentId: id, payload: { code: body?.code }, createdAt: now }));
      return { id: String(ev.id), type: ev.eventType, occurredAt: (ev.occurredAt || now).toISOString(), actorName: userId, code: body?.code, note: body?.note };
    });
    return result;
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
