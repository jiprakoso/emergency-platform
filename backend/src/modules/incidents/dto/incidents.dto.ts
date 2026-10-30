import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page-query.dto';
import { DEFAULT_LIMIT, MAX_LIMIT } from '../../../common/pagination/cursor';
import type { IncidentSeverity } from '../../../database/entities/incident.entity';

/**
 * Badan endpoint insiden, divalidasi ValidationPipe sesuai skema `openapi.yaml`
 * (field wajib = `required` kontrak, mis. `version` pada aksi yang mengubah incident).
 */

const SEVERITIES: IncidentSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'MASS'];
const NOTE_VISIBILITIES = ['INTERNAL', 'LEAD', 'UNITS'] as const;
const MILESTONE_CODES = [
  'SCENE_RELEASED',
  'ROAD_REOPENED',
  'VICTIM_DECEASED_HANDLED',
  'EXTERNAL_UNIT_ARRIVED',
  'EXTERNAL_COORDINATION',
] as const;

class CoordinatesBody {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracyM?: number;
}

/** `version` wajib untuk optimistic locking (REST §5.5). */
class VersionedBody {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class LockBody {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class VerifyBody extends VersionedBody {
  @IsIn(SEVERITIES)
  severity!: IncidentSeverity;

  @IsOptional()
  @IsUUID()
  leadOrganizationId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  summary?: string;
}

export class InvalidateBody extends VersionedBody {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class MergeBody extends VersionedBody {
  @IsUUID()
  targetIncidentId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class LeadBody {
  @IsUUID()
  organizationId!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class ResolveBody extends VersionedBody {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsBoolean()
  forceCloseDispatches?: boolean;
}

export class CloseBody extends VersionedBody {
  @IsOptional()
  @IsString()
  note?: string;
}

export class PatchBody extends VersionedBody {
  @IsOptional()
  @IsString()
  typeCode?: string;

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: IncidentSeverity;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  escalationLevel?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  summary?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinatesBody)
  location?: CoordinatesBody;

  @IsOptional()
  @IsString()
  addressText?: string;
}

export class NoteBody {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsIn(NOTE_VISIBILITIES)
  visibility!: (typeof NOTE_VISIBILITIES)[number];
}

export class CasualtyBody {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  injured!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  deceased!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  critical?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  missing?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class MilestoneBody {
  @IsIn(MILESTONE_CODES)
  code!: (typeof MILESTONE_CODES)[number];

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

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

/** Query `GET /incidents/{id}/nearby` (kontrak: bawaan 300 m / 6 jam; batas atas A-025). */
export class NearbyQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  radiusM: number = 300;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  hours: number = 6;
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
