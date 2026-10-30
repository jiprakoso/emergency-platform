import type { IncidentReport } from '../../database/entities/incident-report.entity';
import type { AttachmentRefData } from '../incidents/incident-views';
import type { PublicStatus } from '../incidents/status-engine';

export type CitizenReportViewSource = {
  /** Koordinat hasil pembacaan kolom geography (ST_X/ST_Y). */
  location: { lat: number; lng: number } | null;
  /** `null` untuk laporan tanpa insiden (CONDITION_REPORT). */
  incident: { id: string; code: string } | null;
  publicStatus: PublicStatus;
  operatingNow: boolean;
  emergencyContacts: Array<{ name: string; phone: string }>;
  attachments: AttachmentRefData[];
};

/** flags tersimpan sebagai larik string di jsonb; kembalikan [] bila bukan larik. */
export function reportFlags(report: IncidentReport): string[] {
  return Array.isArray(report.flags) ? (report.flags as string[]) : [];
}

/**
 * CitizenReportView (kontrak) — dipakai `POST /reports`, `GET /reports/{id}`,
 * `GET /reports/mine`, `GET /incidents/{id}/reports`, follow-up, dan withdraw
 * (AGENTS.md #5: satu serializer per view).
 */
export function toCitizenReportView(report: IncidentReport, src: CitizenReportViewSource) {
  return {
    id: report.id,
    reportKind: report.reportKind,
    status: report.status,
    // IncidentRef tidak nullable di kontrak: dihilangkan untuk laporan tanpa incident.
    ...(src.incident ? { incident: src.incident } : {}),
    publicStatus: src.publicStatus,
    location: src.location ?? { lat: 0, lng: 0 },
    addressText: report.addressText,
    description: report.description,
    flags: reportFlags(report),
    operatingNow: src.operatingNow,
    createdAt: report.createdAt.toISOString(),
    attachments: src.attachments,
    // Kontrak: hanya {name, phone} (pengaturan dapat memuat field lain, mis. `note`).
    emergencyContacts: src.emergencyContacts.map((c) => ({ name: c.name, phone: c.phone })),
  };
}
