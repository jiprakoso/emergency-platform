import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/errors/app-error';
import { decodeCursor, encodeCursor, normalizeLimit } from '../../common/pagination/cursor';
import type { IncidentReport } from '../../database/entities/incident-report.entity';
import { toAttachmentRef } from '../incidents/incident-views';
import { resolvePublicStatuses } from '../incidents/resolve-public-status';
import type { PublicStatus } from '../incidents/status-engine';
import { ReferenceService } from '../reference/reference.service';
import { reportFlags, toCitizenReportView } from './report-view';

type ReportRow = {
  id: string;
  incident_id: string | null;
  report_kind: IncidentReport['reportKind'];
  status: IncidentReport['status'];
  address_text: string | null;
  description: string | null;
  flags: unknown;
  created_at: Date;
  lat: number;
  lng: number;
  incident_code: string | null;
};

const REPORT_SELECT = `
  SELECT r.id, r.incident_id, r.report_kind, r.status, r.address_text, r.description, r.flags, r.created_at,
         ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng, i.code AS incident_code
    FROM incident_reports r LEFT JOIN incidents i ON i.id = r.incident_id`;

/** Teks timeline warga per event publik (REST §4.2, kolom "Teks yang ditampilkan"). */
const TIMELINE_TEXT: Record<string, string> = {
  'incident.created': 'Laporan diterima.',
  'incident.verified': 'Laporan diverifikasi.',
  'incident.invalidated': 'Laporan tidak dapat ditindaklanjuti.',
  'incident.resolved': 'Penanganan selesai.',
};

/**
 * Memuat `CitizenReportView` secara batch (AGENTS.md #5): `publicStatus` lewat rantai
 * DUPLICATE (+ flag `OUT_OF_AREA`), lokasi asli, lampiran terkonfirmasi, serta
 * `operatingNow`/nomor darurat dari `system_settings` (sama dengan `/config/public`).
 */
@Injectable()
export class ReportViewLoader {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly reference: ReferenceService,
  ) {}

  private async build(rows: ReportRow[]) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [config, statuses, attachments] = await Promise.all([
      this.reference.getPublicConfig(),
      resolvePublicStatuses(this.dataSource, rows.flatMap((r) => (r.incident_id ? [r.incident_id] : []))),
      this.dataSource.query(
        `SELECT id, report_id, storage_key, mime_type, kind FROM attachments
          WHERE report_id = ANY($1::uuid[]) AND status = 'CONFIRMED' ORDER BY created_at, id`,
        [ids],
      ) as Promise<Array<{ id: string; report_id: string; storage_key: string; mime_type: string; kind: string }>>,
    ]);
    return rows.map((r) => {
      const flags = reportFlags({ flags: r.flags } as IncidentReport);
      const publicStatus: PublicStatus = flags.includes('OUT_OF_AREA')
        ? 'OUT_OF_AREA'
        : r.incident_id
          ? (statuses.get(r.incident_id) ?? 'RECEIVED')
          : 'RECEIVED';
      const report = {
        id: r.id,
        reportKind: r.report_kind,
        status: r.status,
        addressText: r.address_text,
        description: r.description,
        flags: r.flags,
        createdAt: new Date(r.created_at),
      } as IncidentReport;
      return toCitizenReportView(report, {
        location: { lat: Number(r.lat), lng: Number(r.lng) },
        incident: r.incident_id && r.incident_code ? { id: r.incident_id, code: r.incident_code } : null,
        publicStatus,
        operatingNow: config.operatingNow,
        emergencyContacts: config.emergencyContacts,
        attachments: attachments
          .filter((a) => a.report_id === r.id)
          .map((a) => toAttachmentRef({ id: a.id, storageKey: a.storage_key, mimeType: a.mime_type, kind: a.kind })),
      });
    });
  }

  async one(reportId: string) {
    const rows: ReportRow[] = await this.dataSource.query(`${REPORT_SELECT} WHERE r.id = $1`, [reportId]);
    if (!rows[0]) throw AppError.notFound('Laporan tidak ditemukan.');
    return (await this.build(rows))[0];
  }

  /** Halaman laporan (terbaru dulu, kursor keyset `created_at,id`) dengan filter kolom tunggal. */
  private async page(column: 'reporter_id' | 'incident_id', value: string, opts: { limit?: number; cursor?: string }, newestFirst: boolean) {
    const limit = normalizeLimit(opts.limit);
    const params: unknown[] = [value];
    let where = `r.${column} = $1`;
    if (opts.cursor) {
      const c = decodeCursor(opts.cursor);
      if (typeof c.c !== 'string' || typeof c.i !== 'string') throw AppError.validation('Cursor tidak valid.');
      params.push(c.c, c.i);
      where += ` AND (r.created_at, r.id) ${newestFirst ? '<' : '>'} ($2::timestamptz, $3::uuid)`;
    }
    params.push(limit + 1);
    const dir = newestFirst ? 'DESC' : 'ASC';
    const rows: ReportRow[] = await this.dataSource.query(
      `${REPORT_SELECT} WHERE ${where} ORDER BY r.created_at ${dir}, r.id ${dir} LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      data: await this.build(pageRows),
      page: { hasMore, nextCursor: hasMore && last ? encodeCursor({ c: new Date(last.created_at).toISOString(), i: last.id }) : null },
    };
  }

  /** `GET /reports/mine` — laporan sendiri, terbaru dulu. */
  mine(userId: string, opts: { limit?: number; cursor?: string }) {
    return this.page('reporter_id', userId, opts, true);
  }

  /** `GET /incidents/{id}/reports` — laporan tertaut, urut waktu masuk (kontak pelapor tidak disertakan). */
  forIncident(incidentId: string, opts: { limit?: number; cursor?: string }) {
    return this.page('incident_id', incidentId, opts, false);
  }

  /**
   * `GET /reports/{id}/timeline`: hanya event `PUBLIC` incident (induk bila digabung),
   * berisi teks baku — tanpa aktor, catatan, atau payload.
   */
  async timeline(incidentId: string | null) {
    if (!incidentId) return { data: [], page: { hasMore: false, nextCursor: null } };
    const rows: Array<{ id: string; event_type: string; occurred_at: Date }> = await this.dataSource.query(
      `SELECT id::text AS id, event_type, occurred_at FROM incident_events
        WHERE incident_id = $1 AND visibility = 'PUBLIC' ORDER BY occurred_at, id`,
      [incidentId],
    );
    const data = rows
      .filter((e) => TIMELINE_TEXT[e.event_type])
      .map((e) => ({ id: e.id, at: new Date(e.occurred_at).toISOString(), text: TIMELINE_TEXT[e.event_type], visibility: 'PUBLIC' }));
    return { data, page: { hasMore: false, nextCursor: null } };
  }
}
