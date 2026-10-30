import type { IncidentSeverity, IncidentStatus } from '../../database/entities/incident.entity';
import type { PublicStatus } from './status-engine';
import type { EventVisibility } from '../../database/entities/incident-event.entity';

/** Referensi {code, name} (REST §4). */
export type CodeNameRef = { code: string; name: string };

/** OrganizationRef: {id} wajib; name/type opsional menurut kontrak. */
export type OrgRef = { id: string; name?: string; type?: string };

/**
 * Mask nomor telepon pelapor: `0812****789` (4 awal + **** + 3 akhir).
 * Angka pendek dimask penuh.
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return '****';
  return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
}

export type DispatchSummaryData = {
  active: number;
  offered: number;
  rejected: number;
  expired: number;
  byOrganization: Array<{ organization: OrgRef; active: number }>;
};

export const EMPTY_DISPATCH_SUMMARY: DispatchSummaryData = {
  active: 0,
  offered: 0,
  rejected: 0,
  expired: 0,
  byOrganization: [],
};

export type AttentionReason =
  | 'NEEDS_REPLACEMENT'
  | 'SUGGESTED_DUPLICATE'
  | 'UNSEEN_OFFER'
  | 'PENDING_RESOURCE_REQUEST';

/** Data mentah satu baris antrean insiden (hasil query + agregat). */
export type SummarySource = {
  id: string;
  code: string;
  status: IncidentStatus;
  severity: IncidentSeverity | null;
  createdAt: Date;
  type: CodeNameRef | null;
  district: CodeNameRef | null;
  village: CodeNameRef | null;
  leadOrganization: OrgRef | null;
  dispatchSummary: DispatchSummaryData;
  attentionReasons: AttentionReason[];
};

/** Item daftar `GET /incidents` dan `GET /incidents/{id}/nearby` (skema IncidentSummary). */
export function toIncidentSummary(src: SummarySource) {
  return {
    id: src.id,
    code: src.code,
    type: src.type ?? undefined,
    status: src.status,
    severity: src.severity ?? undefined,
    district: src.district ?? undefined,
    village: src.village ?? undefined,
    leadOrganization: src.leadOrganization ?? undefined,
    createdAt: src.createdAt.toISOString(),
    dispatchSummary: src.dispatchSummary,
    attentionReasons: src.attentionReasons,
  };
}

export type AttachmentRefData = {
  id: string;
  fileName: string;
  mimeType: string;
  kind: string;
};

/**
 * AttachmentRef: `fileName` diturunkan dari `storageKey`
 * (`uploads/{id}/{nama-berkas}` — kolom fileName tidak ada di tabel).
 */
export function toAttachmentRef(row: {
  id: string;
  storageKey: string;
  mimeType: string;
  kind: string;
}): AttachmentRefData {
  const parts = (row.storageKey ?? '').split('/');
  const fileName = parts[parts.length - 1] || row.storageKey;
  return { id: row.id, fileName, mimeType: row.mimeType, kind: row.kind };
}

export type CasualtySnapshotData = {
  injured: number;
  deceased: number;
  critical: number | null;
  missing: number | null;
};

export type DispatchUnitSummaryData = {
  /** Hanya untuk penyaringan internal (dispatch milik sendiri); tidak dikirim ke klien. */
  id?: string;
  organization: OrgRef;
  unit?: { id: string; name?: string; status?: string };
  status: string;
  type: string;
};

/** DispatchUnitSummary (kontrak): tanpa `id` internal. */
function toDispatchUnitSummary(d: DispatchUnitSummaryData) {
  return { organization: d.organization, ...(d.unit ? { unit: d.unit } : {}), status: d.status, type: d.type };
}

export type DispatcherViewSource = {
  id: string;
  code: string;
  status: IncidentStatus;
  publicStatus: PublicStatus;
  severity: IncidentSeverity | null;
  escalationLevel: number | null;
  type: CodeNameRef | null;
  district: CodeNameRef | null;
  village: CodeNameRef | null;
  location: { lat: number; lng: number } | null;
  addressText: string | null;
  description: string | null;
  summary: string | null;
  leadOrganization: OrgRef | null;
  reporter: { name: string | null; phoneMasked: string | null };
  attachments: AttachmentRefData[];
  casualties: CasualtySnapshotData | null;
  dispatches: DispatchUnitSummaryData[];
  lockedBy: string | null;
  lockedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

/** DispatcherViewIncident (kontrak) — serializer dipakai bersama REST/WS/FCM (AGENTS.md #5). */
export function toDispatcherView(src: DispatcherViewSource) {
  return {
    id: src.id,
    code: src.code,
    type: src.type ?? undefined,
    status: src.status,
    publicStatus: src.publicStatus,
    severity: src.severity ?? undefined,
    escalationLevel: src.escalationLevel,
    district: src.district ?? undefined,
    village: src.village ?? undefined,
    location: src.location ?? undefined,
    addressText: src.addressText,
    description: src.description,
    summary: src.summary,
    leadOrganization: src.leadOrganization ?? undefined,
    reporter: src.reporter,
    attachments: src.attachments,
    casualties: src.casualties ?? undefined,
    dispatches: src.dispatches.map(toDispatchUnitSummary),
    lockedBy: src.lockedBy,
    lockedAt: src.lockedAt?.toISOString() ?? null,
    version: src.version,
    createdAt: src.createdAt.toISOString(),
    updatedAt: src.updatedAt.toISOString(),
  };
}

/** Dispatch milik responder yang dipakai sebagai sudut pandang `OfferView`/`UnitView`. */
export type ResponderDispatchData = {
  id: string;
  type: string;
  origin: string;
  status: string;
  offerExpiresAt: Date | null;
  etaMinutes: number | null;
  destinationOrganization: OrgRef | null;
};

/**
 * OfferView (REST §4.1/§4.3, sebelum accept): tanpa lokasi presisi, alamat, deskripsi,
 * lampiran, pelapor, korban, dan dispatch unit lain.
 */
export function toOfferView(src: DispatcherViewSource, dispatch: ResponderDispatchData, distanceM: number | null) {
  return {
    dispatchId: dispatch.id,
    incident: {
      code: src.code,
      type: src.type ?? undefined,
      severity: src.severity ?? undefined,
      district: src.district ?? undefined,
      village: src.village ?? undefined,
      ...(distanceM !== null ? { distanceM } : {}),
    },
    type: dispatch.type,
    origin: dispatch.origin,
    status: dispatch.status,
    offerExpiresAt: dispatch.offerExpiresAt?.toISOString() ?? null,
    note: null,
  };
}

/**
 * UnitView (REST §4.1, sesudah accept): lokasi presisi, alamat, deskripsi, lampiran,
 * korban; dispatch lain hanya ringkasan (`organization`, `status`, `type`) kecuali
 * organisasi lead yang melihat unit juga. Kontak pelapor tetap tidak dikirim.
 */
export function toUnitView(
  src: DispatcherViewSource,
  dispatch: ResponderDispatchData,
  opts: { distanceM: number | null; isLead: boolean },
) {
  const others = src.dispatches.map((d) =>
    opts.isLead ? toDispatchUnitSummary(d) : { organization: d.organization, status: d.status, type: d.type },
  );
  return {
    dispatchId: dispatch.id,
    incident: {
      id: src.id,
      code: src.code,
      type: src.type ?? undefined,
      status: src.status,
      publicStatus: src.publicStatus,
      severity: src.severity ?? undefined,
      escalationLevel: src.escalationLevel,
      district: src.district ?? undefined,
      village: src.village ?? undefined,
      distanceM: opts.distanceM,
      location: src.location ?? undefined,
      addressText: src.addressText,
      description: src.description,
      attachments: src.attachments,
      casualties: src.casualties ?? undefined,
      otherDispatches: others,
    },
    type: dispatch.type,
    origin: dispatch.origin,
    status: dispatch.status,
    offerExpiresAt: dispatch.offerExpiresAt?.toISOString() ?? null,
    note: null,
    etaMinutes: dispatch.etaMinutes,
    ...(dispatch.destinationOrganization ? { destinationOrganization: dispatch.destinationOrganization } : {}),
  };
}

export type EventViewSource = {
  id: string;
  type: string;
  occurredAt: Date;
  actorName?: string | null;
  channel?: string | null;
  code?: string | null;
  note?: string | null;
  visibility: EventVisibility;
};

/**
 * IncidentEventView (kontrak: `id`, `type`, `occurredAt`, `actorName?`, `channel?`, `code?`, `note?`).
 * `visibility` tidak dikirim — penyaringan dilakukan sebelum serialisasi.
 * `actorName` hanya untuk staf (privasi aktor terhadap warga).
 */
export function toEventView(src: EventViewSource, opts: { includeActor: boolean }) {
  const view: Record<string, unknown> = {
    id: src.id,
    type: src.type,
    occurredAt: src.occurredAt.toISOString(),
  };
  if (opts.includeActor && src.actorName) view.actorName = src.actorName;
  if (src.channel) view.channel = src.channel;
  if (src.code) view.code = src.code;
  if (src.note) view.note = src.note;
  return view;
}
