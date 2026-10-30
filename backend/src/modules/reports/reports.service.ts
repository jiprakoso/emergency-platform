import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { IncidentReport } from '../../database/entities/incident-report.entity';
import { Incident } from '../../database/entities/incident.entity';
import { IncidentType } from '../../database/entities/incident-type.entity';
import { Attachment } from '../../database/entities/attachment.entity';
import { OutboxEvent } from '../../database/entities/outbox-event.entity';
import { IncidentEvent } from '../../database/entities/incident-event.entity';
import { User } from '../../database/entities/user.entity';
import { ClockService } from '../../common/clock/clock.service';
import { AppError } from '../../common/errors/app-error';
import { AuthPrincipal } from '../auth/auth.types';
import { randomUUID } from 'node:crypto';
import { CreateReportDto, FollowUpDto, WithdrawDto } from './dto/reports.dto';
import { AuditContext, AuditService } from '../audit/audit.service';
import { SystemSetting } from '../../database/entities/system-setting.entity';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { RateLimitRule, RateLimitRules } from '../../common/rate-limit/rate-limit.rules';

/** Bentuk `system_settings.report_rate_limit` (seed §8). */
type ReportRateLimitSetting = {
  help_request?: { count?: number; window_min?: number; daily?: number };
  condition_report?: { count?: number; window_min?: number };
};

/** REST §5.3 🔶: maksimal lampiran per laporan bila `limits.max_attachments` tidak ada. */
const DEFAULT_MAX_ATTACHMENTS = 5;

const isUniqueViolation = (e: unknown) =>
  e instanceof QueryFailedError && (e.driverError as { code?: string } | undefined)?.code === '23505';

function makeIncidentCode(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  return `INC-${y}${m}${d}-${rand}`;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(IncidentReport) private readonly reports: Repository<IncidentReport>,
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    @InjectRepository(IncidentType) private readonly incidentTypes: Repository<IncidentType>,
    @InjectRepository(Attachment) private readonly attachments: Repository<Attachment>,
    @InjectRepository(OutboxEvent) private readonly outbox: Repository<OutboxEvent>,
    @InjectRepository(IncidentEvent) private readonly incidentEvents: Repository<IncidentEvent>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(SystemSetting) private readonly settings: Repository<SystemSetting>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private async setting<T>(key: string): Promise<T | null> {
    const row = await this.settings.findOne({ where: { key } });
    return (row?.value as T | undefined) ?? null;
  }

  /** Batas laju REST §8, angka dari `system_settings.report_rate_limit` (fallback: aturan bawaan). */
  private async reportRules(kind: CreateReportDto['reportKind']): Promise<RateLimitRule[]> {
    const cfg = await this.setting<ReportRateLimitSetting>('report_rate_limit');
    if (kind === 'CONDITION_REPORT') {
      const c = cfg?.condition_report;
      const base = RateLimitRules.reportsConditionPerUser;
      return [{ ...base, limit: c?.count ?? base.limit, windowSeconds: (c?.window_min ?? base.windowSeconds / 60) * 60 }];
    }
    const h = cfg?.help_request;
    const base = RateLimitRules.reportsHelpPerUser;
    const daily = RateLimitRules.reportsHelpPerUserDaily;
    return [
      { ...base, limit: h?.count ?? base.limit, windowSeconds: (h?.window_min ?? base.windowSeconds / 60) * 60 },
      { ...daily, limit: h?.daily ?? daily.limit },
    ];
  }

  /** Ambil jatah semua aturan; bila satu terlampaui, jatah dikembalikan dan 429. */
  private async consumeRateLimit(rules: RateLimitRule[], userId: string): Promise<void> {
    const results = await Promise.all(rules.map((r) => this.rateLimit.check(r, userId)));
    const blocked = results.filter((r) => !r.allowed);
    if (blocked.length > 0) {
      await this.refundRateLimit(rules, userId);
      throw new AppError('RATE_LIMITED', 'Terlalu banyak laporan. Coba lagi nanti atau hubungi nomor darurat.', undefined, undefined, {
        retryAfterSeconds: Math.max(...blocked.map((r) => r.retryAfterSeconds)),
      });
    }
  }

  private async refundRateLimit(rules: RateLimitRule[], userId: string): Promise<void> {
    await Promise.all(rules.map((r) => this.rateLimit.refund(r, userId)));
  }

  private async assertAttachmentCount(ids: string[] | undefined): Promise<void> {
    if (!ids?.length) return;
    const limits = await this.setting<{ max_attachments?: number }>('limits');
    const max = limits?.max_attachments ?? DEFAULT_MAX_ATTACHMENTS;
    if (new Set(ids).size !== ids.length || ids.length > max) {
      throw AppError.validation(`Lampiran maksimal ${max} dan tidak boleh berulang.`, [{ field: 'attachmentIds', issue: 'invalid' }]);
    }
  }

  /**
   * Tautkan lampiran ke laporan: hanya milik pengunggah sendiri dan belum tertaut
   * (menjaga lampiran orang lain tidak bisa "dicuri"). Gagal satu = transaksi batal.
   */
  private async linkAttachments(manager: EntityManager, ids: string[] | undefined, userId: string, reportId: string, incidentId: string | null): Promise<void> {
    if (!ids?.length) return;
    const res: unknown = await manager.query(
      `UPDATE attachments SET report_id = $1, incident_id = $2
        WHERE id = ANY($3::uuid[]) AND uploaded_by = $4
          AND report_id IS NULL AND incident_id IS NULL AND dispatch_id IS NULL
        RETURNING id`,
      [reportId, incidentId, ids, userId],
    );
    // Driver pg + UPDATE … RETURNING: TypeORM mengembalikan [baris, jumlah].
    const rows = Array.isArray(res) && Array.isArray(res[0]) ? (res[0] as unknown[]) : (res as unknown[]);
    if (rows.length !== ids.length) {
      throw AppError.validation('Lampiran tidak ditemukan atau sudah dipakai.', [{ field: 'attachmentIds', issue: 'invalid' }]);
    }
  }

  /**
   * Pengulangan `clientReportId` (REST §1.3): pemilik yang sama → 200 dengan resource sama;
   * pelapor lain → 422 tanpa membocorkan isi laporan.
   */
  private async replay(existing: IncidentReport, userId: string) {
    if (existing.reporterId !== userId) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'clientReportId sudah dipakai untuk laporan lain.');
    }
    return { data: await this.buildCitizenView(existing), _status: 200 };
  }

  private findByClientReportId(manager: EntityManager | null, clientReportId: string) {
    const repo = manager ? manager.getRepository(IncidentReport) : this.reports;
    return repo.findOne({ where: { clientReportId }, relations: ['incident'] });
  }

  /**
   * Laporan milik pemanggil saja (`report.read_own`, pembatas "milik sendiri").
   * Laporan orang lain dijawab 404 agar keberadaannya tidak bocor (handoff §11 no. 14).
   */
  private async findOwned(id: string, principal: AuthPrincipal | undefined, relations: string[] = []): Promise<IncidentReport> {
    const report = await this.reports.findOne({ where: { id }, relations });
    if (!report || !principal?.userId || report.reporterId !== principal.userId) {
      throw AppError.notFound('Laporan tidak ditemukan.');
    }
    return report;
  }

  async createReport(principal: AuthPrincipal, body: CreateReportDto) {
    const userId = principal.userId;
    // Pengulangan dicek sebelum batas laju: tidak dihitung (REST §8).
    const existing = await this.findByClientReportId(null, body.clientReportId);
    if (existing) return this.replay(existing, userId);

    const type = await this.incidentTypes.findOne({ where: { code: body.typeCode } });
    if (!type) throw AppError.validation('Tipe kejadian tidak valid.');

    if (body.reportKind === 'CONDITION_REPORT' && !type.allowsConditionReport) {
      throw new AppError('REPORT_KIND_NOT_ALLOWED', 'Laporan kondisi tidak diizinkan untuk jenis kejadian ini.');
    }
    await this.assertAttachmentCount(body.attachmentIds);

    const rules = await this.reportRules(body.reportKind);
    let consumed = false;

    const now = this.clock.now();
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : now;

    let outcome: { report: IncidentReport; created: boolean };
    try {
      outcome = await this.dataSource.transaction(async (manager) => {
        // Serialkan pengiriman bersamaan dengan clientReportId sama (S5), lalu cek ulang:
        // pemenang membuat laporan, sisanya melihat hasil commit-nya.
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [body.clientReportId]);
        const dup = await this.findByClientReportId(manager, body.clientReportId);
        if (dup) return { report: dup, created: false };
        // Jatah diambil setelah pasti laporan baru: pengulangan (termasuk yang kalah
        // balapan) tidak pernah dihitung (REST §8).
        await this.consumeRateLimit(rules, userId);
        consumed = true;

        let incident: Incident | null = null;
        if (body.reportKind === 'HELP_REQUEST') {
          // Buat incident baru (sederhana untuk awal)
          const incidentRepo = manager.getRepository(Incident);
          const incidentEventsRepo = manager.getRepository(IncidentEvent);
          const outboxRepo = manager.getRepository(OutboxEvent);

          const code = makeIncidentCode(now);
          const incidentId = randomUUID();
          // insert dengan location geography
          await incidentRepo.query(
            `INSERT INTO incidents (id, code, type_id, status, source, summary, location, address_text, district_id, village_id, report_count, first_reported_at, version, created_at, updated_at)
             VALUES ($1,$2,$3,'SUBMITTED','MOBILE_APP',$4, ST_SetSRID(ST_MakePoint($5,$6),4326)::geography, $7, NULL, NULL, 1, $8, 1, $9, $10)`,
            [incidentId, code, type.id, body.description?.substring(0, 255) || type.name, body.location.lng, body.location.lat, body.addressText || null, occurredAt, now, now],
          );
          incident = await incidentRepo.findOne({ where: { id: incidentId } });

          await incidentEventsRepo.save(
            incidentEventsRepo.create({
              incidentId,
              eventType: 'incident.created',
              actorUserId: userId,
              visibility: 'INTERNAL',
              occurredAt: now,
              recordedAt: now,
              payload: { source: 'MOBILE_APP' },
            }),
          );
          await outboxRepo.save(
            outboxRepo.create({
              eid: randomUUID(),
              eventType: 'incident.created',
              incidentId,
              payload: { incidentId, code },
              createdAt: now,
            }),
          );
        }

        const reportRepo = manager.getRepository(IncidentReport);
        const reportId = randomUUID();
        await reportRepo.query(
          `INSERT INTO incident_reports (id, incident_id, report_kind, type_id, reporter_id, channel, client_report_id, location, address_text, description, victim_hint, status, flags, occurred_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,'APP',$6, ST_SetSRID(ST_MakePoint($7,$8),4326)::geography, $9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            reportId,
            incident?.id || null,
            body.reportKind,
            type.id,
            userId,
            body.clientReportId,
            body.location.lng,
            body.location.lat,
            body.addressText || null,
            body.description || null,
            body.victimHint || null,
            body.reportKind === 'HELP_REQUEST' && incident ? 'LINKED' : 'NEW',
            body.reportKind === 'CONDITION_REPORT' ? JSON.stringify(['OUT_OF_AREA']) : null, // placeholder
            occurredAt,
            now,
            now,
          ],
        );

        await this.linkAttachments(manager, body.attachmentIds, userId, reportId, incident?.id ?? null);

        const report = await reportRepo.findOne({ where: { id: reportId }, relations: ['incident'] });
        return { report: report!, created: true };
      });
    } catch (e) {
      if (consumed) await this.refundRateLimit(rules, userId);
      // Cadangan bila kunci advisory terlewati (mis. sumber tulis lain): UNIQUE tetap menjaga.
      if (isUniqueViolation(e)) {
        const dup = await this.findByClientReportId(null, body.clientReportId);
        if (dup) return this.replay(dup, userId);
      }
      throw e;
    }

    if (!outcome.created) return this.replay(outcome.report, userId);
    return { data: await this.buildCitizenView(outcome.report), _status: 201 };
  }

  private async buildCitizenView(report: IncidentReport) {
    // Bentuk sederhana sesuai contoh; cukup untuk memenuhi kontrak dasar
    const view: Record<string, unknown> = {
      id: report.id,
      reportKind: report.reportKind,
      status: report.status,
      location: { lat: 0, lng: 0 }, // akan diisi jika perlu; tapi kontrak minta object
      addressText: report.addressText,
      description: report.description,
      flags: report.flags || [],
      operatingNow: true,
      createdAt: report.createdAt?.toISOString(),
      attachments: [],
      emergencyContacts: [
        { name: 'Darurat Terpadu (contoh)', phone: '000-112' },
      ],
    };
    // Parse location sederhana
    try {
      const raw = (await this.reports.query(`SELECT ST_X(location::geometry) as lng, ST_Y(location::geometry) as lat FROM incident_reports WHERE id = $1`, [report.id])) as Array<{ lat: number | string; lng: number | string }>;
      if (raw[0]) {
        view.location = { lat: Number(raw[0].lat), lng: Number(raw[0].lng) };
      }
    } catch { /* lokasi tidak terbaca: biarkan koordinat default */ }
    if (report.incidentId && report.incident) {
      view.incident = { id: report.incident.id, code: report.incident.code };
      view.publicStatus = 'RECEIVED';
    }
    return view;
  }

  async mine(principal: AuthPrincipal | undefined) {
    const userId = principal?.userId;
    const list = await this.reports.find({ where: { reporterId: userId }, order: { createdAt: 'DESC' }, take: 25 });
    // return page envelope style? controller will wrap
    return { data: list.map(r => ({ id: r.id, reportKind: r.reportKind, status: r.status, createdAt: r.createdAt })), page: { hasMore: false, limit: 25 } };
  }

  async getById(id: string, principal: AuthPrincipal | undefined) {
    const report = await this.findOwned(id, principal, ['incident']);
    return this.buildCitizenView(report);
  }

  async timeline(id: string, principal: AuthPrincipal | undefined) {
    const report = await this.findOwned(id, principal);
    // Ambil incident_events terkait jika ada incident (hanya PUBLIC untuk warga)
    const events = report.incidentId
      ? await this.incidentEvents.find({ where: { incidentId: report.incidentId }, order: { id: 'ASC' }, take: 50 })
      : [];
    const data = events
      .filter((e) => e.visibility === 'PUBLIC')
      .map((e) => ({ id: String(e.id), type: e.eventType, at: e.occurredAt?.toISOString(), visibility: e.visibility }));
    return { data, page: { hasMore: false, limit: 50 } };
  }

  async followUp(id: string, principal: AuthPrincipal, body: FollowUpDto) {
    const userId = principal.userId;
    const report = await this.findOwned(id, principal, ['incident']);
    if (!report.incidentId) throw AppError.validation('Laporan belum terhubung ke insiden.');
    const incidentId = report.incidentId;

    const replayFollowUp = async (dup: IncidentReport) => {
      if (dup.reporterId !== userId || dup.incidentId !== incidentId) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'clientReportId sudah dipakai untuk laporan lain.');
      }
      return this.buildCitizenView(dup);
    };
    const existing = await this.findByClientReportId(null, body.clientReportId);
    if (existing) return replayFollowUp(existing);
    await this.assertAttachmentCount(body.attachmentIds);

    const now = this.clock.now();
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [body.clientReportId]);
        const dup = await this.findByClientReportId(manager, body.clientReportId);
        if (dup) return { report: dup, created: false };

        const reportRepo = manager.getRepository(IncidentReport);
        const reportId = randomUUID();
        // Lokasi baru bila dikirim, selain itu lokasi laporan induk.
        await reportRepo.query(
          `INSERT INTO incident_reports (id, incident_id, report_kind, type_id, reporter_id, channel, client_report_id, location, address_text, description, victim_hint, status, created_at, updated_at)
           SELECT $1, $2, 'HELP_REQUEST', $3, $4, 'APP', $5,
                  COALESCE(ST_SetSRID(ST_MakePoint($6::float8, $7::float8), 4326)::geography, p.location),
                  p.address_text, $8, $9, 'NEW', $10, $10
             FROM incident_reports p WHERE p.id = $11`,
          [reportId, incidentId, report.typeId, userId, body.clientReportId, body.location?.lng ?? null, body.location?.lat ?? null, body.description, body.victimHint ?? null, now, report.id],
        );
        await this.linkAttachments(manager, body.attachmentIds, userId, reportId, incidentId);
        return { report: (await reportRepo.findOne({ where: { id: reportId }, relations: ['incident'] }))!, created: true };
      });
      return result.created ? this.buildCitizenView(result.report) : replayFollowUp(result.report);
    } catch (e) {
      if (isUniqueViolation(e)) {
        const dup = await this.findByClientReportId(null, body.clientReportId);
        if (dup) return replayFollowUp(dup);
      }
      throw e;
    }
  }

  async withdraw(id: string, principal: AuthPrincipal | undefined, _body: WithdrawDto) {
    const report = await this.findOwned(id, principal, ['incident']);
    report.status = 'WITHDRAWN';
    await this.reports.save(report);
    // Catat audit/event sederhana
    return this.buildCitizenView(report);
  }

  /**
   * Buka nama/nomor pelapor penuh (`pii.reveal_reporter`). Nilai dibaca dari
   * laporan (input manual) atau akun pelapor (laporan aplikasi). Baris audit
   * `pii.view_reporter` ditulis di transaksi yang sama, tanpa nilai PII-nya.
   */
  async revealContact(id: string, principal: AuthPrincipal, ctx: AuditContext) {
    return this.dataSource.transaction(async (manager) => {
      const report = await manager.getRepository(IncidentReport).findOne({ where: { id }, relations: ['reporter'] });
      if (!report) throw AppError.notFound('Laporan tidak ditemukan.');
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'pii.view_reporter',
          entityType: 'incident_report',
          entityId: report.id,
          after: { incidentId: report.incidentId, fields: ['name', 'phone'] },
        },
        ctx,
        manager,
      );
      return {
        name: report.reporterName ?? report.reporter?.fullName ?? null,
        phone: report.reporterPhone ?? report.reporter?.phone ?? null,
      };
    });
  }
}
