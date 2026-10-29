import { AppError } from '../../common/errors/app-error';
import type { IncidentStatus } from '../../database/entities/incident.entity';

/**
 * Mesin status insiden berbasis tabel transisi (REST §6.1, AGENTS.md #8).
 * Status di luar tabel ditolak dengan 409 INVALID_STATUS_TRANSITION.
 */
export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  // Dari              Ke
  SUBMITTED: ['VERIFIED', 'INVALID', 'DUPLICATE'],
  VERIFIED: ['INVALID', 'DUPLICATE', 'IN_PROGRESS', 'RESOLVED'],
  IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
  INVALID: [],
  DUPLICATE: [],
};

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return (INCIDENT_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: IncidentStatus, to: IncidentStatus): void {
  if (!canTransition(from, to)) {
    throw AppError.conflict('Transisi status tidak diizinkan.', 'INVALID_STATUS_TRANSITION');
  }
}

/** Status `IN_PROGRESS` dipicu otomatis oleh dispatch pertama (tabel §6.1). */
export const AUTOMATIC_TRANSITION_TRIGGERS = {
  firstAcceptedDispatch: { from: 'VERIFIED' as IncidentStatus, to: 'IN_PROGRESS' as IncidentStatus },
};

export type PublicStatus =
  | 'RECEIVED'
  | 'VERIFIED'
  | 'UNIT_DISPATCHED'
  | 'UNIT_EN_ROUTE'
  | 'UNIT_ON_SCENE'
  | 'RESOLVED'
  | 'NOT_VALID'
  | 'OUT_OF_AREA';

/** Agregat dispatch aktif pada satu insiden (untuk penurunan publicStatus §4.2). */
export type DispatchStatusAgg = {
  /** Ada dispatch OFFERED/ACCEPTED */
  offeredOrAccepted: boolean;
  /** Ada dispatch EN_ROUTE */
  enRoute: boolean;
  /** Ada dispatch ON_SCENE */
  onScene: boolean;
};

export const EMPTY_DISPATCH_AGG: DispatchStatusAgg = {
  offeredOrAccepted: false,
  enRoute: false,
  onScene: false,
};

/**
 * §4.2: publicStatus diturunkan dari status insiden + keadaan dispatch.
 * Pemanggil wajib menyelesaikan rantai DUPLICATE ke insiden induknya lebih dulu
 * (dan menangani flag OUT_OF_AREA pada tingkat laporan).
 */
export function computePublicStatus(
  status: IncidentStatus,
  agg: DispatchStatusAgg,
): PublicStatus {
  if (status === 'INVALID') return 'NOT_VALID';
  if (status === 'RESOLVED' || status === 'CLOSED') return 'RESOLVED';
  if (status === 'SUBMITTED') return 'RECEIVED';
  // VERIFIED / IN_PROGRESS: bergantung pada dispatch
  if (agg.onScene) return 'UNIT_ON_SCENE';
  if (agg.enRoute) return 'UNIT_EN_ROUTE';
  if (agg.offeredOrAccepted) return 'UNIT_DISPATCHED';
  return 'VERIFIED';
}
