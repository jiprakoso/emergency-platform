import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Incident } from '../../database/entities/incident.entity';
import { IncidentEvent } from '../../database/entities/incident-event.entity';
import { OutboxEvent } from '../../database/entities/outbox-event.entity';
import { SystemSetting } from '../../database/entities/system-setting.entity';
import { ClockService } from '../../common/clock/clock.service';
import { AppError } from '../../common/errors/app-error';
import { AuthPrincipal } from '../auth/auth.types';
import { PermissionService } from '../permissions/permission.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    @InjectRepository(IncidentEvent) private readonly incidentEvents: Repository<IncidentEvent>,
    @InjectRepository(OutboxEvent) private readonly outbox: Repository<OutboxEvent>,
    @InjectRepository(SystemSetting) private readonly settings: Repository<SystemSetting>,
    private readonly clock: ClockService,
    private readonly permissions: PermissionService,
  ) {}

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
    const inc = await this.incidents.findOne({ where: { id } });
    if (!inc) throw AppError.notFound('Insiden tidak ditemukan.');
    // If no principal or public-like, return limited? But route requires auth typically
    if (!principal?.userId) return inc;

    const userId = principal.userId;
    // Try to determine if dispatcher/admin
    const canReadAll = await this.permissions.hasPermission(userId, 'incident.read_all').catch(() => false);
    if (canReadAll || principal.roles?.includes('DISPATCHER') || principal.roles?.includes('SUPERVISOR') || principal.roles?.includes('ADMIN')) {
      // Build DispatcherViewIncident-like shape
      return {
        id: inc.id,
        code: inc.code,
        type: inc.typeId ? { code: inc.typeId, name: inc.typeId } : undefined,
        status: inc.status,
        publicStatus: (inc as any).publicStatus,
        severity: inc.severity,
        escalationLevel: inc.escalationLevel,
        district: inc.districtId ? { code: inc.districtId, name: inc.districtId } : undefined,
        village: inc.villageId ? { code: inc.villageId, name: inc.villageId } : undefined,
        location: inc.location ? { lat: (inc.location as any).coordinates?.[1], lng: (inc.location as any).coordinates?.[0] } : undefined,
        addressText: inc.addressText,
        description: inc.summary || (inc as any).description,
        summary: inc.summary,
        leadOrganization: inc.leadOrganizationId ? { id: inc.leadOrganizationId } : undefined,
        reporter: { name: null, phoneMasked: null },
        attachments: [],
        casualties: null,
        dispatches: [],
        lockedBy: inc.lockedBy,
        lockedAt: inc.lockedAt,
        version: inc.version,
        createdAt: inc.createdAt,
        updatedAt: inc.updatedAt,
      };
    }
    // For responder/unit - could return UnitView/OfferView; simplest safe: return limited
    return {
      id: inc.id,
      code: inc.code,
      type: inc.typeId ? { code: inc.typeId, name: inc.typeId } : undefined,
      status: inc.status,
      publicStatus: (inc as any).publicStatus,
      severity: inc.severity,
      district: inc.districtId ? { code: inc.districtId, name: inc.districtId } : undefined,
      village: inc.villageId ? { code: inc.villageId, name: inc.villageId } : undefined,
      location: inc.location ? { lat: (inc.location as any).coordinates?.[1], lng: (inc.location as any).coordinates?.[0] } : undefined,
      addressText: inc.addressText,
    };
  }

  private async getLockSeconds(): Promise<number> {
    const row = await this.settings.findOne({ where: { key: 'incident_lock_seconds' } });
    const val = row?.value as any;
    if (typeof val === 'number') return val;
    if (val && typeof val.value === 'number') return val.value;
    return 300;
  }

  async lock(id: string, principal: AuthPrincipal | undefined, body?: any) {
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
      .set({ lockedBy: userId, lockedAt: now, lockExpiresAt: expiresAt, version: inc.version + 1, updatedAt: now } as any)
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
    inc.lockedBy = null as any;
    inc.lockedAt = null as any;
    inc.lockExpiresAt = null as any;
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

  async verify(id: string, principal: AuthPrincipal | undefined, body?: any) {
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
          eid: uuidv4(),
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

  async invalidate(id: string, principal: AuthPrincipal | undefined, body?: any) {
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
          eid: uuidv4(),
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

  async merge(id: string, principal: AuthPrincipal | undefined, body?: any) {
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
      await outRepo.save(outRepo.create({ eid: uuidv4(), eventType: 'incident.duplicated', incidentId: inc.id, payload: { incidentId: inc.id }, createdAt: now }));
      return inc;
    });
    return result;
  }

  async setLead(id: string, principal: AuthPrincipal | undefined, body?: any) {
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
      await outRepo.save(outRepo.create({ eid: uuidv4(), eventType: 'incident.lead_set', incidentId: inc.id, payload: { incidentId: inc.id }, createdAt: now }));
      return inc;
    });
    return result;
  }

  async resolve(id: string, principal: AuthPrincipal | undefined, body?: any) {
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
      await outRepo.save(outRepo.create({ eid: uuidv4(), eventType: 'incident.resolved', incidentId: inc.id, payload: { incidentId: inc.id }, createdAt: now }));
      return inc;
    });
    return result;
  }

  async close(id: string, principal: AuthPrincipal | undefined, body?: any) {
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
      await outRepo.save(outRepo.create({ eid: uuidv4(), eventType: 'incident.closed', incidentId: inc.id, payload: { incidentId: inc.id }, createdAt: now }));
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
         ORDER BY dist_m ASC
         LIMIT 50`,
        [id, hours],
      );
      const data = rows.map((r: any) => ({
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
}
