import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page-query.dto';
import { DEFAULT_LIMIT, MAX_LIMIT } from '../../../common/pagination/cursor';
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
  version?: number;
  reason?: string;
};

export type ResolveBody = {
  version?: number;
  note?: string;
  forceCloseDispatches?: true;
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

/** Query `GET /incidents` (kontrak: filter + sort + limit/cursor). */
export class IncidentsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  typeCode?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  districtId?: string;

  @IsOptional()
  @IsString()
  leadOrgId?: string;

  @IsOptional()
  @IsString()
  lockedBy?: string;

  @IsOptional()
  @IsString()
  flag?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  q?: string;

  /** `-createdAt` (default) atau `-severity`. */
  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number = DEFAULT_LIMIT;

  @IsOptional()
  @IsString()
  cursor?: string;
}

/** Query `GET /incidents/{id}/events` (kursor `afterId`). */
export class EventsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  afterId?: string;
}

/** Query `GET /incidents/{id}/dispatch-recommendations`. */
export class RecommendationsQueryDto {
  @IsOptional()
  @IsString()
  orgType?: string;

  @IsOptional()
  @IsString()
  unitType?: string;
}
