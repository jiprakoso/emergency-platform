import { AppError } from '../../common/errors/app-error';
import type { IncidentStatus } from '../../database/entities/incident.entity';
import { assertTransition, canTransition, computePublicStatus, EMPTY_DISPATCH_AGG, INCIDENT_TRANSITIONS } from './status-engine';

const ALL: IncidentStatus[] = ['SUBMITTED', 'VERIFIED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'INVALID', 'DUPLICATE'];

/** REST §6.1, ditulis ulang di sini sebagai sumber pembanding independen. */
const ALLOWED = new Set([
  'SUBMITTED>VERIFIED',
  'SUBMITTED>INVALID',
  'VERIFIED>INVALID',
  'SUBMITTED>DUPLICATE',
  'VERIFIED>DUPLICATE',
  'VERIFIED>IN_PROGRESS',
  'VERIFIED>RESOLVED',
  'IN_PROGRESS>RESOLVED',
  'RESOLVED>CLOSED',
]);

const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

describe('mesin status incident (REST §6.1)', () => {
  it('tabel transisi mencakup semua status', () => {
    expect(Object.keys(INCIDENT_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it.each(pairs)('%s → %s sesuai tabel §6.1', (from, to) => {
    const expected = ALLOWED.has(`${from}>${to}`);
    expect(canTransition(from, to)).toBe(expected);
    if (expected) {
      expect(() => assertTransition(from, to)).not.toThrow();
    } else {
      let err: unknown;
      try {
        assertTransition(from, to);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('INVALID_STATUS_TRANSITION');
      expect((err as AppError).getStatus()).toBe(409);
    }
  });

  it('status final tidak punya transisi keluar (hanya maju)', () => {
    for (const s of ['CLOSED', 'INVALID', 'DUPLICATE'] as const) {
      expect(INCIDENT_TRANSITIONS[s]).toEqual([]);
    }
  });
});

describe('publicStatus (REST §4.2)', () => {
  it.each([
    ['SUBMITTED', EMPTY_DISPATCH_AGG, 'RECEIVED'],
    ['VERIFIED', EMPTY_DISPATCH_AGG, 'VERIFIED'],
    ['VERIFIED', { ...EMPTY_DISPATCH_AGG, offeredOrAccepted: true }, 'UNIT_DISPATCHED'],
    ['IN_PROGRESS', { ...EMPTY_DISPATCH_AGG, offeredOrAccepted: true, enRoute: true }, 'UNIT_EN_ROUTE'],
    ['IN_PROGRESS', { offeredOrAccepted: true, enRoute: true, onScene: true }, 'UNIT_ON_SCENE'],
    ['RESOLVED', EMPTY_DISPATCH_AGG, 'RESOLVED'],
    ['CLOSED', EMPTY_DISPATCH_AGG, 'RESOLVED'],
    ['INVALID', EMPTY_DISPATCH_AGG, 'NOT_VALID'],
  ] as const)('%s + dispatch %j → %s', (status, agg, expected) => {
    expect(computePublicStatus(status, agg)).toBe(expected);
  });
});
