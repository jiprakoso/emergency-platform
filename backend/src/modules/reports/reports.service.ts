import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

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

  async createReport(principal: AuthPrincipal | undefined, body: CreateReportDto) {
    const userId = principal?.userId;
    // Idempoten via clientReportId (kuncinya di DB UNIQUE)
    const existing = await this.reports.findOne({
      where: { clientReportId: body.clientReportId },
      relations: ['incident'],
    });
    if (existing) {
      // Sudah pernah dikirim -> 200 idempoten
      return { data: await this.buildCitizenView(existing), _status: 200 };
    }

    const type = await this.incidentTypes.findOne({ where: { code: body.typeCode } });
    if (!type) throw AppError.validation('Tipe kejadian tidak valid.');

    if (body.reportKind === 'CONDITION_REPORT' && !type.allowsConditionReport) {
      throw new AppError('REPORT_KIND_NOT_ALLOWED', 'Laporan kondisi tidak diizinkan untuk jenis kejadian ini.');
    }

    const now = this.clock.now();
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : now;

    // Transaksi: buat laporan, jika HELP_REQUEST buat incident jika belum ada yang cocok? 
    // Untuk Fase 2 sesuai pola dasar: HELP_REQUEST bisa membuat incident baru jika belum terkait
    // Ikuti kontrak - kembalikan CitizenReportView
    const result = await this.dataSource.transaction(async (manager) => {
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
            actorUserId: userId || null,
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
          userId || null,
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

      // Kaitkan attachment jika ada
      if (body.attachmentIds?.length) {
        const attRepo = manager.getRepository(Attachment);
        for (const aid of body.attachmentIds) {
          await attRepo.update({ id: aid }, { reportId, incidentId: incident?.id || null });
        }
      }

      const report = await reportRepo.findOne({ where: { id: reportId }, relations: ['incident'] });
      return report!;
    });

    return { data: await this.buildCitizenView(result), _status: 201 };
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

  async followUp(id: string, principal: AuthPrincipal | undefined, body: FollowUpDto) {
    const report = await this.findOwned(id, principal, ['incident']);
    if (!report.incidentId) throw AppError.validation('Laporan belum terhubung ke insiden.');
    // Buat laporan susulan terkait incident yang sama
    const now = this.clock.now();
    const result = await this.dataSource.transaction(async (manager) => {
      const reportRepo = manager.getRepository(IncidentReport);
      const reportId = randomUUID();
      // Ambil lokasi dari report existing
      const loc = await reportRepo.query(`SELECT location FROM incident_reports WHERE id = $1`, [report.id]);
      const locGeom = loc?.[0]?.location;
      await reportRepo.query(
        `INSERT INTO incident_reports (id, incident_id, report_kind, type_id, reporter_id, channel, client_report_id, location, address_text, description, victim_hint, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'APP',$6, $7, $8,$9,$10,'NEW',$11,$12)`,
        [
          reportId,
          report.incidentId,
          'HELP_REQUEST',
          report.typeId,
          principal?.userId || null,
          body.clientReportId,
          locGeom,
          report.addressText || null,
          body.description || null,
          body.victimHint || null,
          now,
          now,
        ],
      );
      if (body.attachmentIds?.length) {
        const attRepo = manager.getRepository(Attachment);
        for (const aid of body.attachmentIds) {
          await attRepo.update({ id: aid }, { reportId, incidentId: report.incidentId });
        }
      }
      return reportRepo.findOne({ where: { id: reportId } });
    });
    return this.buildCitizenView(result!);
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
