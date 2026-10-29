import type { EventVisibility } from '../../../database/entities/incident-event.entity';
import type { IncidentSeverity } from '../../../database/entities/incident.entity';

/**
 * Tipe badan untuk endpoint insiden.
 * Sengaja type alias (bukan interface) agar dapat ditugaskan ke `Record<string, unknown>`
 * saat ditulis ke `incident_events.payload` / `outbox_events.payload`.
 * Hanya mengetik badan yang memang dibaca kode saat ini — tanpa validator,
 * sehingga perilaku masuk tidak berubah.
 */

export type LockBody = {
  force?: boolean;
};

export type VerifyBody = {
  version?: number;
  severity?: IncidentSeverity;
  leadOrganizationId?: string;
  summary?: string;
};

export type InvalidateBody = {
  version?: number;
  reason?: string;
};

export type MergeBody = {
  version?: number;
  targetIncidentId?: string;
  reason?: string;
};

export type LeadBody = {
  organizationId?: string;
  reason?: string;
};

export type ResolveBody = {
  version?: number;
  note?: string;
};

export type CloseBody = {
  version?: number;
  note?: string;
};

export type PatchBody = {
  version?: number;
  severity?: IncidentSeverity;
  escalationLevel?: number;
  summary?: string;
  addressText?: string;
};

export type NoteBody = {
  text?: string;
  visibility?: EventVisibility;
};

export type CasualtyBody = {
  injured?: number;
  deceased?: number;
  critical?: number | null;
  missing?: number | null;
  note?: string;
};

export type MilestoneBody = {
  code?: string;
  note?: string;
  occurredAt?: string;
  payload?: Record<string, unknown>;
};
