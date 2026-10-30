import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClockService } from '../../common/clock/clock.service';
import { AppError } from '../../common/errors/app-error';
import { decodeCursor, encodeCursor, normalizeLimit } from '../../common/pagination/cursor';
import type { IncidentSeverity, IncidentStatus } from '../../database/entities/incident.entity';
import type { EventVisibility } from '../../database/entities/incident-event.entity';
import type { AuthPrincipal } from '../auth/auth.types';
import {
  AttentionReason,
  DispatcherViewSource,
  DispatchSummaryData,
  EMPTY_DISPATCH_SUMMARY,
  maskPhone,
  ResponderDispatchData,
  SummarySource,
  toAttachmentRef,
  toDispatcherView,
  toEventView,
  toIncidentSummary,
  toOfferView,
  toUnitView,
} from './incident-views';
import { resolvePublicStatus } from './resolve-public-status';
import type { IncidentsQueryDto } from './dto/incidents.dto';

const INCIDENT_STATUSES: IncidentStatus[] = ['SUBMITTED', 'VERIFIED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'INVALID', 'DUPLICATE'];
const SEVERITIES: IncidentSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'MASS'];
/** Peringkat untuk `sort=-severity` (tanpa severity = paling bawah). */
const SEVERITY_RANK_SQL = `CASE i.severity WHEN 'MASS' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END`;
/** A-025: dispatch "aktif" = sudah diterima/berjalan (RESPOND) atau NOTIFY yang belum final. */
const ACTIVE_DISPATCH = `('ACCEPTED','EN_ROUTE','ON_SCENE','NOTIFIED','READY','FULL','PATIENT_ARRIVED')`;
/** Dispatch responder yang sudah melewati offer → `UnitView` (REST §4.1). */
const ACCEPTED_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE', 'DONE'];
const OPEN_INCIDENT = `('SUBMITTED','VERIFIED','IN_PROGRESS')`;

type Queryable = Pick<DataSource, 'query'>;
type Ref = { code: string; name: string } | null;

type IncidentRow = {
  id: string;
  code: string;
  status: IncidentStatus;
  severity: IncidentSeverity | null;
  escalation_level: number | null;
  summary: string | null;
  address_text: string | null;
  lat: number | null;
  lng: number | null;
  locked_by: string | null;
  locked_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  lead_organization_id: string | null;
  type: Ref;
  district: Ref;
  village: Ref;
  lead: { id: string; name: string; type: string } | null;
};

/** Kolom + relasi dasar satu incident (dipakai semua view). */
const INCIDENT_SELECT = `
  SELECT i.id, i.code, i.status, i.severity, i.escalation_level, i.summary, i.address_text,
         ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lng,
         i.locked_by, i.locked_at, i.version, i.created_at, i.updated_at, i.lead_organization_id,
         CASE WHEN t.id IS NULL THEN NULL ELSE json_build_object('code', t.code, 'name', t.name) END AS type,
         CASE WHEN d.id IS NULL THEN NULL ELSE json_build_object('code', d.code, 'name', d.name) END AS district,
         CASE WHEN v.id IS NULL THEN NULL ELSE json_build_object('code', v.code, 'name', v.name) END AS village,
         CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('id', o.id, 'name', o.name, 'type', o.type) END AS lead
    FROM incidents i
    LEFT JOIN incident_types t ON t.id = i.type_id
    LEFT JOIN regions d ON d.id = i.district_id
    LEFT JOIN regions v ON v.id = i.village_id
    LEFT JOIN organizations o ON o.id = i.lead_organization_id`;

/**
 * Memuat data view incident dari DB lalu memanggil serializer bersama
 * (`incident-views.ts`, AGENTS.md #5). Semua daftar dimuat secara batch (tanpa N+1).
 */
@Injectable()
export class IncidentViewLoader {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
  ) {}

  private async loadRow(id: string, q: Queryable): Promise<IncidentRow> {
    const rows: IncidentRow[] = await q.query(`${INCIDENT_SELECT} WHERE i.id = $1`, [id]);
    if (!rows[0]) throw AppError.notFound('Insiden tidak ditemukan.');
    return rows[0];
  }

  /** Sumber lengkap DispatcherView (juga dasar OfferView/UnitView). */
  private async loadSource(id: string, q: Queryable): Promise<DispatcherViewSource> {
    const row = await this.loadRow(id, q);
    const [reporterRows, attachments, casualtyRows, dispatches, publicStatus] = await Promise.all([
      // Pelapor & deskripsi = laporan pertama yang tertaut (kontak dimask, REST §4.1).
      q.query(
        `SELECT r.description, COALESCE(r.reporter_name, u.full_name) AS name, COALESCE(r.reporter_phone, u.phone) AS phone
           FROM incident_reports r LEFT JOIN users u ON u.id = r.reporter_id
          WHERE r.incident_id = $1 ORDER BY r.created_at, r.id LIMIT 1`,
        [id],
      ) as Promise<Array<{ description: string | null; name: string | null; phone: string | null }>>,
      q.query(
        `SELECT id, storage_key, mime_type, kind FROM attachments
          WHERE incident_id = $1 AND status = 'CONFIRMED' ORDER BY created_at, id`,
        [id],
      ) as Promise<Array<{ id: string; storage_key: string; mime_type: string; kind: string }>>,
      q.query(
        `SELECT injured_count, deceased_count, critical_count, missing_count FROM incident_casualties
          WHERE incident_id = $1 ORDER BY reported_at DESC, created_at DESC LIMIT 1`,
        [id],
      ) as Promise<Array<{ injured_count: number; deceased_count: number; critical_count: number | null; missing_count: number | null }>>,
      q.query(
        `SELECT d.id, d.status, d.type,
                json_build_object('id', o.id, 'name', o.name, 'type', o.type) AS organization,
                CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id', u.id, 'name', u.name, 'status', u.status) END AS unit
           FROM dispatches d JOIN organizations o ON o.id = d.organization_id LEFT JOIN units u ON u.id = d.unit_id
          WHERE d.incident_id = $1 ORDER BY d.created_at, d.id`,
        [id],
      ) as Promise<Array<{ id: string; status: string; type: string; organization: { id: string; name: string; type: string }; unit: { id: string; name: string; status: string } | null }>>,
      resolvePublicStatus(q as DataSource, id),
    ]);
    const reporter = reporterRows[0];
    const c = casualtyRows[0];
    return {
      id: row.id,
      code: row.code,
      status: row.status,
      publicStatus,
      severity: row.severity,
      escalationLevel: row.escalation_level,
      type: row.type,
      district: row.district,
      village: row.village,
      location: row.lat === null || row.lng === null ? null : { lat: Number(row.lat), lng: Number(row.lng) },
      addressText: row.address_text,
      description: reporter?.description ?? null,
      summary: row.summary,
      leadOrganization: row.lead,
      reporter: { name: reporter?.name ?? null, phoneMasked: maskPhone(reporter?.phone) },
      attachments: attachments.map((a) => toAttachmentRef({ id: a.id, storageKey: a.storage_key, mimeType: a.mime_type, kind: a.kind })),
      casualties: c
        ? { injured: c.injured_count, deceased: c.deceased_count, critical: c.critical_count, missing: c.missing_count }
        : null,
      dispatches: dispatches.map((d) => ({
        id: d.id,
        organization: d.organization,
        ...(d.unit ? { unit: d.unit } : {}),
        status: d.status,
        type: d.type,
      })),
      lockedBy: row.locked_by,
      lockedAt: row.locked_at,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** `DispatcherViewIncident` — dipakai GET detail dan respons semua aksi dispatcher (CC-005). */
  async dispatcherView(id: string, q: Queryable = this.dataSource) {
    return toDispatcherView(await this.loadSource(id, q));
  }

  /**
   * `OfferView` / `UnitView` (REST §4.1) untuk responder, berdasarkan dispatch milik
   * unit/organisasinya. Tanpa dispatch → 404 (A-024), termasuk organisasi lead.
   */
  async responderView(id: string, principal: AuthPrincipal) {
    const row = await this.loadRow(id, this.dataSource);
    const isLead = !!principal.orgId && row.lead_organization_id === principal.orgId;
    const mine: Array<{
      id: string;
      type: string;
      origin: string;
      status: string;
      accepted_at: Date | null;
      offer_expires_at: Date | null;
      eta_minutes: number | null;
      distance_m: number | null;
      destination: { id: string; name: string; type: string } | null;
    }> = await this.dataSource.query(
      `SELECT d.id, d.type, d.origin, d.status, d.accepted_at, d.offer_expires_at, d.eta_minutes,
              ROUND(ST_Distance(u.last_location, i.location))::int AS distance_m,
              CASE WHEN dest.id IS NULL THEN NULL ELSE json_build_object('id', dest.id, 'name', dest.name, 'type', dest.type) END AS destination
         FROM dispatches d
         JOIN incidents i ON i.id = d.incident_id
         LEFT JOIN units u ON u.id = COALESCE(d.unit_id, $3::uuid)
         LEFT JOIN organizations dest ON dest.id = d.destination_organization_id
        WHERE d.incident_id = $1
          AND (d.organization_id = $2::uuid OR ($3::uuid IS NOT NULL AND d.unit_id = $3::uuid))
        ORDER BY (d.unit_id IS NOT DISTINCT FROM $3::uuid) DESC,
                 (d.accepted_at IS NOT NULL OR d.status = ANY($4::text[])) DESC,
                 d.created_at DESC
        LIMIT 1`,
      [id, principal.orgId ?? null, principal.unitId ?? null, ACCEPTED_STATUSES],
    );
    const d = mine[0];
    if (!d) throw AppError.notFound('Insiden tidak ditemukan.');
    const dispatch: ResponderDispatchData = {
      id: d.id,
      type: d.type,
      origin: d.origin,
      status: d.status,
      offerExpiresAt: d.offer_expires_at,
      etaMinutes: d.eta_minutes,
      destinationOrganization: d.destination,
    };
    const src = await this.loadSource(id, this.dataSource);
    const distanceM = d.distance_m === null ? null : Number(d.distance_m);
    // NOTIFY (IGD) tidak pernah "accept": tetap tanpa lokasi lokasi kejadian (A-024).
    const accepted = d.type === 'RESPOND' && (d.accepted_at !== null || ACCEPTED_STATUSES.includes(d.status));
    if (!accepted) return toOfferView(src, dispatch, distanceM);
    return toUnitView({ ...src, dispatches: src.dispatches.filter((x) => x.id !== d.id) }, dispatch, { distanceM, isLead });
  }

  /** Ringkasan dispatch + alasan perhatian untuk banyak incident sekaligus (A-025). */
  private async aggregates(ids: string[]): Promise<Map<string, { summary: DispatchSummaryData; reasons: AttentionReason[] }>> {
    const out = new Map<string, { summary: DispatchSummaryData; reasons: AttentionReason[] }>();
    if (ids.length === 0) return out;
    const now = this.clock.now();
    const [counts, byOrg, reasons] = await Promise.all([
      this.dataSource.query(
        `SELECT incident_id,
                count(*) FILTER (WHERE status IN ${ACTIVE_DISPATCH})::int AS active,
                count(*) FILTER (WHERE status = 'OFFERED')::int AS offered,
                count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
                count(*) FILTER (WHERE status = 'EXPIRED')::int AS expired
           FROM dispatches WHERE incident_id = ANY($1::uuid[]) GROUP BY incident_id`,
        [ids],
      ) as Promise<Array<{ incident_id: string; active: number; offered: number; rejected: number; expired: number }>>,
      this.dataSource.query(
        `SELECT d.incident_id, json_build_object('id', o.id, 'name', o.name, 'type', o.type) AS organization, count(*)::int AS active
           FROM dispatches d JOIN organizations o ON o.id = d.organization_id
          WHERE d.incident_id = ANY($1::uuid[]) AND d.status IN ${ACTIVE_DISPATCH}
          GROUP BY d.incident_id, o.id, o.name, o.type ORDER BY o.name`,
        [ids],
      ) as Promise<Array<{ incident_id: string; organization: { id: string; name: string; type: string }; active: number }>>,
      this.dataSource.query(
        `SELECT i.id,
                EXISTS (
                  SELECT 1 FROM dispatches d WHERE d.incident_id = i.id AND d.type = 'RESPOND' AND d.status IN ('REJECTED','EXPIRED')
                     AND NOT EXISTS (SELECT 1 FROM dispatches n WHERE n.incident_id = i.id AND n.type = 'RESPOND' AND n.created_at > d.updated_at)
                ) AS needs_replacement,
                EXISTS (
                  SELECT 1 FROM incident_reports r WHERE r.incident_id = i.id AND r.suggested_incident_id IS NOT NULL
                     AND r.suggested_incident_id <> i.id
                ) AND i.status = 'SUBMITTED' AS suggested_duplicate,
                EXISTS (
                  SELECT 1 FROM dispatches d WHERE d.incident_id = i.id AND d.status = 'OFFERED' AND d.offer_seen_at IS NULL
                     AND d.offered_at <= $2::timestamptz - make_interval(secs => COALESCE(
                       (SELECT (value #>> '{}')::int FROM system_settings WHERE key = 'offer_unseen_seconds'), 60))
                ) AS unseen_offer,
                EXISTS (SELECT 1 FROM resource_requests rr WHERE rr.incident_id = i.id AND rr.status = 'PENDING') AS pending_rr
           FROM incidents i WHERE i.id = ANY($1::uuid[]) AND i.status IN ${OPEN_INCIDENT}`,
        [ids, now],
      ) as Promise<Array<{ id: string; needs_replacement: boolean; suggested_duplicate: boolean; unseen_offer: boolean; pending_rr: boolean }>>,
    ]);
    for (const id of ids) out.set(id, { summary: { ...EMPTY_DISPATCH_SUMMARY, byOrganization: [] }, reasons: [] });
    for (const c of counts) {
      const e = out.get(c.incident_id)!;
      e.summary = { ...e.summary, active: c.active, offered: c.offered, rejected: c.rejected, expired: c.expired };
    }
    for (const b of byOrg) out.get(b.incident_id)!.summary.byOrganization.push({ organization: b.organization, active: b.active });
    for (const r of reasons) {
      const list = out.get(r.id)!.reasons;
      if (r.needs_replacement) list.push('NEEDS_REPLACEMENT');
      if (r.suggested_duplicate) list.push('SUGGESTED_DUPLICATE');
      if (r.unseen_offer) list.push('UNSEEN_OFFER');
      if (r.pending_rr) list.push('PENDING_RESOURCE_REQUEST');
    }
    return out;
  }

  private async summaries(rows: IncidentRow[]) {
    const agg = await this.aggregates(rows.map((r) => r.id));
    return rows.map((r) => {
      const a = agg.get(r.id)!;
      const src: SummarySource = {
        id: r.id,
        code: r.code,
        status: r.status,
        severity: r.severity,
        createdAt: r.created_at,
        type: r.type,
        district: r.district,
        village: r.village,
        leadOrganization: r.lead,
        dispatchSummary: a.summary,
        attentionReasons: a.reasons,
      };
      return toIncidentSummary(src);
    });
  }

  /** `GET /incidents`: filter REST §5.5, urutan `-createdAt` (bawaan) / `createdAt` / `-severity`, kursor keyset. */
  async list(query: IncidentsQueryDto) {
    const limit = normalizeLimit(query.limit);
    const sort = query.sort ?? '-createdAt';
    if (!['-createdAt', 'createdAt', '-severity'].includes(sort)) {
      throw AppError.validation('Parameter sort tidak valid.', [{ field: 'sort', issue: 'invalid' }]);
    }
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };

    if (query.status) {
      const statuses = query.status.split(',').map((x) => x.trim()).filter(Boolean);
      if (statuses.some((x) => !INCIDENT_STATUSES.includes(x as IncidentStatus))) {
        throw AppError.validation('Parameter status tidak valid.', [{ field: 'status', issue: 'invalid' }]);
      }
      add('i.status = ANY(?::text[])', statuses);
    }
    if (query.severity) {
      if (!SEVERITIES.includes(query.severity as IncidentSeverity)) {
        throw AppError.validation('Parameter severity tidak valid.', [{ field: 'severity', issue: 'invalid' }]);
      }
      add('i.severity = ?', query.severity);
    }
    if (query.typeCode) add('t.code = ?', query.typeCode);
    if (query.districtId) add('i.district_id = ?::uuid', uuidParam(query.districtId, 'districtId'));
    if (query.leadOrgId) add('i.lead_organization_id = ?::uuid', uuidParam(query.leadOrgId, 'leadOrgId'));
    if (query.lockedBy) add('i.locked_by = ?::uuid', uuidParam(query.lockedBy, 'lockedBy'));
    if (query.flag) add(`COALESCE(i.flags, '[]'::jsonb) @> jsonb_build_array(?::text)`, query.flag);
    if (query.from) add('i.created_at >= ?::timestamptz', dateParam(query.from, 'from'));
    if (query.to) add('i.created_at < ?::timestamptz', dateParam(query.to, 'to'));
    if (query.q) {
      add(`(i.code ILIKE ? OR i.summary ILIKE $${params.length + 1} OR i.address_text ILIKE $${params.length + 1})`, `%${query.q}%`);
    }

    // Keyset: (rank, created_at, id) dibandingkan sebagai baris, arah mengikuti urutan.
    const rank = sort === '-severity' ? SEVERITY_RANK_SQL : '0';
    const desc = sort !== 'createdAt';
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      if (typeof c.c !== 'string' || typeof c.i !== 'string' || typeof c.r !== 'number' || c.s !== sort) {
        throw AppError.validation('Cursor tidak valid.');
      }
      params.push(c.r, c.c, c.i);
      const n = params.length;
      where.push(`(${rank}, i.created_at, i.id) ${desc ? '<' : '>'} ($${n - 2}::int, $${n - 1}::timestamptz, $${n}::uuid)`);
    }
    params.push(limit + 1);
    const dir = desc ? 'DESC' : 'ASC';
    const rows: Array<IncidentRow & { rank: number }> = await this.dataSource.query(
      `SELECT * FROM (${INCIDENT_SELECT.replace('SELECT i.id,', `SELECT ${rank} AS rank, i.id,`)}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}) x
        ORDER BY x.rank ${dir}, x.created_at ${dir}, x.id ${dir} LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      data: await this.summaries(page),
      page: {
        hasMore,
        nextCursor: hasMore && last ? encodeCursor({ s: sort, r: Number(last.rank), c: new Date(last.created_at).toISOString(), i: last.id }) : null,
      },
    };
  }

  /** `GET /incidents/{id}/nearby`: kandidat duplikat aktif dalam radius & jendela waktu (PostGIS). */
  async nearby(id: string, radiusM: number, hours: number) {
    await this.loadRow(id, this.dataSource);
    const rows: IncidentRow[] = await this.dataSource.query(
      `${INCIDENT_SELECT}
        CROSS JOIN (SELECT location FROM incidents WHERE id = $1) src
        WHERE i.id <> $1 AND i.location IS NOT NULL AND i.status IN ${OPEN_INCIDENT}
          AND i.created_at >= $4::timestamptz - make_interval(hours => $3::int)
          AND ST_DWithin(i.location, src.location, $2::float8)
        ORDER BY ST_Distance(i.location, src.location), i.created_at DESC
        LIMIT 50`,
      [id, radiusM, hours, this.clock.now()],
    );
    return { data: await this.summaries(rows) };
  }

  /**
   * `GET /incidents/{id}/events` (kursor `afterId`). Dispatcher melihat semua; responder
   * terkait hanya `UNITS`/`PUBLIC` (+`LEAD` bila organisasinya lead) — REST §5.5, ERD.
   */
  async events(id: string, visibilities: EventVisibility[] | null, opts: { afterId?: string; limit?: number }) {
    await this.loadRow(id, this.dataSource);
    const limit = normalizeLimit(opts.limit);
    if (opts.afterId !== undefined && !/^\d+$/.test(opts.afterId)) {
      throw AppError.validation('afterId tidak valid.', [{ field: 'afterId', issue: 'invalid' }]);
    }
    const rows: Array<{ id: string; event_type: string; occurred_at: Date; actor_name: string | null; channel: string | null; payload: Record<string, unknown> | null; visibility: EventVisibility }> =
      await this.dataSource.query(
        `SELECT e.id::text AS id, e.event_type, e.occurred_at, u.full_name AS actor_name, e.channel, e.payload, e.visibility
           FROM incident_events e LEFT JOIN users u ON u.id = e.actor_user_id
          WHERE e.incident_id = $1
            AND ($2::text[] IS NULL OR e.visibility = ANY($2::text[]))
            AND ($3::bigint IS NULL OR e.id > $3::bigint)
          ORDER BY e.id LIMIT $4`,
        [id, visibilities, opts.afterId ?? null, limit + 1],
      );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map((e) => toEventView(eventSource(e), { includeActor: true })),
      page: { hasMore, nextCursor: hasMore ? page[page.length - 1].id : null },
    };
  }
}

/** Baris `incident_events` → sumber IncidentEventView (catatan: `payload.text`, milestone: `payload.code/note`). */
export function eventSource(e: { id: string; event_type: string; occurred_at: Date; actor_name?: string | null; channel: string | null; payload: Record<string, unknown> | null; visibility: EventVisibility }) {
  const p = e.payload ?? {};
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  return {
    id: e.id,
    type: e.event_type,
    occurredAt: new Date(e.occurred_at),
    actorName: e.actor_name ?? null,
    channel: e.channel,
    code: e.event_type === 'incident.milestone' ? str(p.code) : null,
    note: str(p.text) ?? str(p.note),
    visibility: e.visibility,
  };
}

function uuidParam(value: string, field: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw AppError.validation(`Parameter ${field} tidak valid.`, [{ field, issue: 'invalid' }]);
  }
  return value;
}

function dateParam(value: string, field: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw AppError.validation(`Parameter ${field} tidak valid.`, [{ field, issue: 'invalid' }]);
  }
  return new Date(value).toISOString();
}
