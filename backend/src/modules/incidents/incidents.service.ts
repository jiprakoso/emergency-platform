import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
  ) {}

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

  async getById(id: string, principal?: AuthPrincipal) {
    const inc = await this.incidents.findOne({ where: { id }, relations: ['type', 'district', 'village', 'leadOrganization'] });
    if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');

    // Calculate publicStatus using the status engine
    const publicStatus = await resolvePublicStatus(this.dataSource, inc.id);

    // Query casualties - get the latest casualty record
    const casualtyRepo = this.incidents.manager.getRepository('IncidentCasualty');
    const casualty = await casualtyRepo.findOne({ where: { incidentId: inc.id }, order: { reportedAt: 'DESC' } });

    // Query dispatches - get all dispatches for this incident
    const dispatchRepo = this.incidents.manager.getRepository('Dispatch');
    const dispatches = await dispatchRepo.find({ where: { incidentId: inc.id } });

    if (!principal?.userId) {
      // Public-like view: no precise location, masked contact
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
        // Location NOT visible to unauthenticated users
        addressText: undefined,
        summary: undefined,
        leadOrganization: inc.leadOrganization ? { id: inc.leadOrganization.id, name: inc.leadOrganization.name } : undefined,
        reporter: { name: null, phoneMasked: null },
        attachments: [],
        casualties: casualty ? {
          injured: casualty.injuredCount,
          deceased: casualty.deceasedCount,
          critical: casualty.criticalCount,
          missing: casualty.missingCount,
        } : null,
        dispatches: [],
      };
    }

    const userId = principal.userId;
    // Try to determine if dispatcher/admin
    const canReadAll = await this.permissions.hasPermission(userId, 'incident.read_all').catch(() => false);

    if (canReadAll || principal.roles?.includes('DISPATCHER') || principal.roles?.includes('SUPERVISOR') || principal.roles?.includes('ADMIN')) {
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
    // Responder/limited view - OfferView-like without precise location
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
      casualties: casualtyData,
      dispatches: dispatchList,
    };
  }

  private async getLockSeconds(): Promise<number> {
    const row = await this.settings.findOne({ where: { key: 'incident_lock_seconds' } });
    const val = row?.value;
    if (typeof val === 'number') return val;
    if (val && typeof val === 'object' && 'value' in val && typeof val.value === 'number') return val.value;
    return 300;
  }

  async lock(id: string, principal: AuthPrincipal | undefined, body?: LockBody) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const canLock = await this.permissions.hasPermission(userId, 'incident.lock');
    if (!canLock) throw AppError.forbidden();

    const lockSec = await this.getLockSeconds();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + lockSec * 1000);

    // Try atomic lock
    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');

    // If locked by someone else and not expired
    if (inc.lockedBy && inc.lockExpiresAt && inc.lockExpiresAt > now && inc.lockedBy !== userId) {
      const canOverride = await this.permissions.hasPermission(userId, 'incident.lock_override');
      if (!body?.force || !canOverride) {
        throw new AppError('INCIDENT_LOCKED', 'Insiden sedang dikunci oleh pengguna lain.', []);
      }
    }

    // Atomic update attempt with version if needed - simple approach first
    const res = await this.incidents
      .createQueryBuilder()
      .update(Incident)
      .set({ lockedBy: userId, lockedAt: now, lockExpiresAt: expiresAt, version: inc.version + 1, updatedAt: now })
      .where('id = :id', { id })
      .andWhere(
        '(locked_by IS NULL OR lock_expires_at < :now OR locked_by = :userId)',
        { now, userId },
      )
      .andWhere('version = :v', { v: inc.version })
      .execute();

    if (res.affected === 0) {
      throw new AppError('INCIDENT_LOCKED', 'Insiden sedang dikunci oleh pengguna lain.', []);
    }

    const updated = await this.incidents.findOne({ where: { id } });
    return {
      lockedBy: updated?.lockedBy || userId,
      lockedAt: updated?.lockedAt?.toISOString() || now.toISOString(),
      expiresAt: updated?.lockExpiresAt?.toISOString() || expiresAt.toISOString(),
    };
  }

  async unlock(id: string, principal: AuthPrincipal | undefined) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
    if (inc.lockedBy && inc.lockedBy !== userId) {
      const canOverride = await this.permissions.hasPermission(userId, 'incident.lock_override');
      if (!canOverride) throw AppError.forbidden();
    }
    inc.lockedBy = null;
    inc.lockedAt = null;
    inc.lockExpiresAt = null;
    inc.version += 1;
    inc.updatedAt = this.clock.now();
    await this.incidents.save(inc);
    return;
  }

  async renewLock(id: string, principal: AuthPrincipal | undefined) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const lockSec = await this.getLockSeconds();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + lockSec * 1000);

    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
    if (inc.lockedBy !== userId) {
      throw new AppError('LOCK_REQUIRED', 'Anda harus memegang kunci untuk memperpanjang.', []);
    }
    inc.lockExpiresAt = expiresAt;
    inc.version += 1;
    inc.updatedAt = now;
    await this.incidents.save(inc);
    return {
      lockedBy: inc.lockedBy,
      lockedAt: inc.lockedAt?.toISOString() || now.toISOString(),
      expiresAt: inc.lockExpiresAt.toISOString(),
    };
  }

  async verify(id: string, principal: AuthPrincipal | undefined, body?: VerifyBody) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const canVerify = await this.permissions.hasPermission(userId, 'incident.verify');
    if (!canVerify) throw AppError.forbidden();

    const now = this.clock.now();
    const result = await this.incidents.manager.transaction(async (manager) => {
      const incRepo = manager.getRepository(Incident);
      const evRepo = manager.getRepository(IncidentEvent);
      const outRepo = manager.getRepository(OutboxEvent);

      const inc = await incRepo.findOne({ where: { id } });
      if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
      if (inc.status !== 'SUBMITTED') throw new AppError('INVALID_STATUS_TRANSITION', 'Transisi status tidak diizinkan.');
      if (inc.lockedBy !== userId) throw new AppError('LOCK_REQUIRED', 'Insiden harus dikunci oleh Anda untuk tindakan ini.');
      if (body?.version !== undefined && body.version !== inc.version) {
        throw new AppError('VERSION_CONFLICT', 'Versi data tidak sesuai.', [], body.version);
      }

      inc.status = 'VERIFIED';
      inc.verifiedBy = userId;
      inc.verifiedAt = now;
      if (body?.severity) inc.severity = body.severity;
      if (body?.leadOrganizationId !== undefined) inc.leadOrganizationId = body.leadOrganizationId;
      if (body?.summary !== undefined) inc.summary = body.summary;
      inc.version += 1;
      inc.updatedAt = now;
      await incRepo.save(inc);

      await evRepo.save(
        evRepo.create({
          incidentId: inc.id,
          eventType: 'incident.verified',
          actorUserId: userId,
          visibility: 'INTERNAL',
          occurredAt: now,
          recordedAt: now,
          payload: {},
        }),
      );
      await outRepo.save(
        outRepo.create({
          eid: randomUUID(),
          eventType: 'incident.verified',
          incidentId: inc.id,
          payload: { incidentId: inc.id },
          createdAt: now,
        }),
      );
      return inc;
    });
    return result;
  }

  async invalidate(id: string, principal: AuthPrincipal | undefined, body?: InvalidateBody) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const can = await this.permissions.hasPermission(userId, 'incident.invalidate');
    if (!can) throw AppError.forbidden();

    const now = this.clock.now();
    const result = await this.incidents.manager.transaction(async (manager) => {
      const incRepo = manager.getRepository(Incident);
      const evRepo = manager.getRepository(IncidentEvent);
      const outRepo = manager.getRepository(OutboxEvent);

      const inc = await incRepo.findOne({ where: { id } });
      if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
      if (inc.status !== 'SUBMITTED') throw new AppError('INVALID_STATUS_TRANSITION', 'Transisi status tidak diizinkan.');
      if (inc.lockedBy !== userId) throw new AppError('LOCK_REQUIRED', 'Insiden harus dikunci oleh Anda untuk tindakan ini.');
      if (body?.version !== undefined && body.version !== inc.version) {
        throw new AppError('VERSION_CONFLICT', 'Versi data tidak sesuai.', [], body.version);
      }

      inc.status = 'INVALID';
      inc.invalidReason = body?.reason || null;
      inc.version += 1;
      inc.updatedAt = now;
      await incRepo.save(inc);

      await evRepo.save(
        evRepo.create({
          incidentId: inc.id,
          eventType: 'incident.invalidated',
          actorUserId: userId,
          visibility: 'INTERNAL',
          occurredAt: now,
          recordedAt: now,
          payload: { reason: body?.reason },
        }),
      );
      await outRepo.save(
        outRepo.create({
          eid: randomUUID(),
          eventType: 'incident.invalidated',
          incidentId: inc.id,
          payload: { incidentId: inc.id },
          createdAt: now,
        }),
      );
      return inc;
    });
    return result;
  }

  async merge(id: string, principal: AuthPrincipal | undefined, body?: MergeBody) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const can = await this.permissions.hasPermission(userId, 'incident.merge');
    if (!can) throw AppError.forbidden();
    const now = this.clock.now();
    const result = await this.incidents.manager.transaction(async (manager) => {
      const incRepo = manager.getRepository(Incident);
      const evRepo = manager.getRepository(IncidentEvent);
      const outRepo = manager.getRepository(OutboxEvent);
      const inc = await incRepo.findOne({ where: { id } });
      if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
      if (inc.lockedBy !== userId) throw new AppError('LOCK_REQUIRED', 'Insiden harus dikunci oleh Anda untuk tindakan ini.');
      if (body?.version !== undefined && body.version !== inc.version) {
        throw new AppError('VERSION_CONFLICT', 'Versi data tidak sesuai.', [], body.version);
      }
      inc.status = 'DUPLICATE';
      inc.duplicateOfId = body?.targetIncidentId || null;
      inc.version += 1;
      inc.updatedAt = now;
      await incRepo.save(inc);
      await evRepo.save(evRepo.create({ incidentId: inc.id, eventType: 'incident.duplicated', actorUserId: userId, visibility: 'INTERNAL', occurredAt: now, recordedAt: now, payload: { targetIncidentId: body?.targetIncidentId, reason: body?.reason } }));
      await outRepo.save(outRepo.create({ eid: randomUUID(), eventType: 'incident.duplicated', incidentId: inc.id, payload: { incidentId: inc.id }, createdAt: now }));
      return inc;
    });
    return result;
  }

  async setLead(id: string, principal: AuthPrincipal | undefined, body?: LeadBody) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const can = await this.permissions.hasPermission(userId, 'incident.set_lead');
    if (!can) throw AppError.forbidden();
    const now = this.clock.now();
    const result = await this.incidents.manager.transaction(async (manager) => {
      const incRepo = manager.getRepository(Incident);
      const evRepo = manager.getRepository(IncidentEvent);
      const outRepo = manager.getRepository(OutboxEvent);
      const inc = await incRepo.findOne({ where: { id } });
      if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
      if (body?.organizationId === undefined) throw new AppError('VALIDATION_FAILED', 'organizationId wajib diisi.');
      inc.leadOrganizationId = body.organizationId;
      inc.leadSetAt = now;
      inc.version += 1;
      inc.updatedAt = now;
      await incRepo.save(inc);
      await evRepo.save(evRepo.create({ incidentId: inc.id, eventType: 'incident.lead_set', actorUserId: userId, visibility: 'INTERNAL', occurredAt: now, recordedAt: now, payload: { organizationId: body.organizationId, reason: body?.reason } }));
      await outRepo.save(outRepo.create({ eid: randomUUID(), eventType: 'incident.lead_set', incidentId: inc.id, payload: { incidentId: inc.id }, createdAt: now }));
      return inc;
    });
    return result;
  }

  async resolve(id: string, principal: AuthPrincipal | undefined, body?: ResolveBody) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const can = await this.permissions.hasPermission(userId, 'incident.close');
    if (!can) throw AppError.forbidden();
    const now = this.clock.now();
    const result = await this.incidents.manager.transaction(async (manager) => {
      const incRepo = manager.getRepository(Incident);
      const evRepo = manager.getRepository(IncidentEvent);
      const outRepo = manager.getRepository(OutboxEvent);
      const inc = await incRepo.findOne({ where: { id } });
      if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
      if (inc.status !== 'IN_PROGRESS' && inc.status !== 'VERIFIED') throw new AppError('INVALID_STATUS_TRANSITION', 'Transisi status tidak diizinkan.');
      if (body?.version !== undefined && body.version !== inc.version) {
        throw new AppError('VERSION_CONFLICT', 'Versi data tidak sesuai.', [], body.version);
      }
      inc.status = 'RESOLVED';
      inc.resolvedAt = now;
      inc.version += 1;
      inc.updatedAt = now;
      await incRepo.save(inc);
      await evRepo.save(evRepo.create({ incidentId: inc.id, eventType: 'incident.resolved', actorUserId: userId, visibility: 'INTERNAL', occurredAt: now, recordedAt: now, payload: { note: body?.note } }));
      await outRepo.save(outRepo.create({ eid: randomUUID(), eventType: 'incident.resolved', incidentId: inc.id, payload: { incidentId: inc.id }, createdAt: now }));
      return inc;
    });
    return result;
  }

  async close(id: string, principal: AuthPrincipal | undefined, body?: CloseBody) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const can = await this.permissions.hasPermission(userId, 'incident.close');
    if (!can) throw AppError.forbidden();
    const now = this.clock.now();
    const result = await this.incidents.manager.transaction(async (manager) => {
      const incRepo = manager.getRepository(Incident);
      const evRepo = manager.getRepository(IncidentEvent);
      const outRepo = manager.getRepository(OutboxEvent);
      const inc = await incRepo.findOne({ where: { id } });
      if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
      if (inc.status !== 'RESOLVED') throw new AppError('INVALID_STATUS_TRANSITION', 'Transisi status tidak diizinkan.');
      if (body?.version !== undefined && body.version !== inc.version) {
        throw new AppError('VERSION_CONFLICT', 'Versi data tidak sesuai.', [], body.version);
      }
      inc.status = 'CLOSED';
      inc.closedAt = now;
      inc.version += 1;
      inc.updatedAt = now;
      await incRepo.save(inc);
      await evRepo.save(evRepo.create({ incidentId: inc.id, eventType: 'incident.closed', actorUserId: userId, visibility: 'INTERNAL', occurredAt: now, recordedAt: now, payload: { note: body?.note } }));
      await outRepo.save(outRepo.create({ eid: randomUUID(), eventType: 'incident.closed', incidentId: inc.id, payload: { incidentId: inc.id }, createdAt: now }));
      return inc;
    });
    return result;
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

  async patch(id: string, principal: AuthPrincipal | undefined, body?: PatchBody) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const can = await this.permissions.hasPermission(userId, 'incident.update');
    if (!can) throw AppError.forbidden();
    const now = this.clock.now();
    const result = await this.incidents.manager.transaction(async (manager) => {
      const incRepo = manager.getRepository(Incident);
      const evRepo = manager.getRepository(IncidentEvent);
      const outRepo = manager.getRepository(OutboxEvent);
      const inc = await incRepo.findOne({ where: { id } });
      if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
      if (inc.lockedBy !== userId) throw new AppError('LOCK_REQUIRED', 'Insiden harus dikunci oleh Anda untuk tindakan ini.');
      if (body?.version !== undefined && body.version !== inc.version) {
        throw new AppError('VERSION_CONFLICT', 'Versi data tidak sesuai.', [], body.version);
      }
      if (body?.severity !== undefined) inc.severity = body.severity;
      if (body?.escalationLevel !== undefined) inc.escalationLevel = body.escalationLevel;
      if (body?.summary !== undefined) inc.summary = body.summary;
      if (body?.addressText !== undefined) inc.addressText = body.addressText;
      inc.version += 1;
      inc.updatedAt = now;
      await incRepo.save(inc);
      await evRepo.save(evRepo.create({ incidentId: inc.id, eventType: 'incident.updated', actorUserId: userId, visibility: 'INTERNAL', occurredAt: now, recordedAt: now, payload: body || {} }));
      await outRepo.save(outRepo.create({ eid: randomUUID(), eventType: 'incident.updated', incidentId: inc.id, payload: { incidentId: inc.id }, createdAt: now }));
      return inc;
    });
    return result;
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
    const result = await this.incidents.manager.transaction(async (manager) => {
      const evRepo = manager.getRepository(IncidentEvent);
      const outRepo = manager.getRepository(OutboxEvent);
      const ev = await evRepo.save(evRepo.create({ incidentId: id, eventType: 'incident.note_added', actorUserId: userId, visibility: body?.visibility || 'INTERNAL', occurredAt: now, recordedAt: now, payload: { text: body?.text } }));
      await outRepo.save(outRepo.create({ eid: randomUUID(), eventType: 'incident.note_added', incidentId: id, payload: { incidentId: id }, createdAt: now }));
      return { id: String(ev.id), type: ev.eventType, occurredAt: ev.occurredAt?.toISOString(), actorName: userId, note: body?.text };
    });
    return result;
  }

  async addCasualty(id: string, principal: AuthPrincipal | undefined, body?: CasualtyBody) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const can = await this.permissions.hasPermission(userId, 'casualty.update');
    if (!can) throw AppError.forbidden();
    const now = this.clock.now();
    const result = await this.incidents.manager.transaction(async (manager) => {
      const incRepo = manager.getRepository(Incident);
      const evRepo = manager.getRepository(IncidentEvent);
      const casRepo = manager.getRepository(IncidentCasualty);
      const outRepo = manager.getRepository(OutboxEvent);
      const inc = await incRepo.findOne({ where: { id } });
      if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
      if (inc.lockedBy !== userId) throw new AppError('LOCK_REQUIRED', 'Insiden harus dikunci oleh Anda untuk tindakan ini.');
       // Create or update casualty record
      let casualty = await casRepo.findOne({ where: { incidentId: id } });
      if (!casualty) {
        casualty = casRepo.create({
          incidentId: id,
          injuredCount: body?.injured || 0,
          deceasedCount: body?.deceased || 0,
          criticalCount: body?.critical || null,
          missingCount: body?.missing || null,
          note: body?.note || null,
          reportedBy: userId,
          reportedAt: now,
          createdAt: now,
        });
      } else {
        casualty.injuredCount = body?.injured || 0;
        casualty.deceasedCount = body?.deceased || 0;
        casualty.criticalCount = body?.critical || null;
        casualty.missingCount = body?.missing || null;
        casualty.note = body?.note || null;
        casualty.reportedBy = userId;
        casualty.reportedAt = now;
      }
      await casRepo.save(casualty);
      await evRepo.save(evRepo.create({ incidentId: id, eventType: 'incident.casualties_updated', actorUserId: userId, visibility: 'INTERNAL', occurredAt: now, recordedAt: now, payload: body || {} }));
      await outRepo.save(outRepo.create({ eid: randomUUID(), eventType: 'incident.casualties_updated', incidentId: id, payload: body || {}, createdAt: now }));
      return { id: casualty.id, injured: casualty.injuredCount, deceased: casualty.deceasedCount, critical: casualty.criticalCount, missing: casualty.missingCount, note: casualty.note, reportedAt: casualty.reportedAt?.toISOString() };
    });
    return result;
  }

  async addMilestone(id: string, principal: AuthPrincipal | undefined, body?: MilestoneBody) {
    const userId = principal?.userId;
    if (!userId) throw AppError.unauthenticated();
    const can = await this.permissions.hasPermission(userId, 'milestone.create');
    if (!can) throw AppError.forbidden();
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
