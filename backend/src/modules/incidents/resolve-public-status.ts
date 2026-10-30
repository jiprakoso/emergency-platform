import type { DataSource } from 'typeorm';
import type { IncidentStatus } from '../../database/entities/incident.entity';
import { computePublicStatus, type DispatchStatusAgg, type PublicStatus } from './status-engine';

type Leaf = { id: string; status: IncidentStatus };

/**
 * Ikuti rantai `duplicate_of_id` sampai insiden induknya (maks 5 lompatan).
 * Bila insiden tidak ditemukan, perlakukan sebagai `SUBMITTED`.
 */
export async function resolveLeafIncident(ds: DataSource, incidentId: string): Promise<Leaf> {
  const rows = (await ds.query(
    `WITH RECURSIVE chain AS (
       SELECT id, status, duplicate_of_id, 0 AS depth FROM incidents WHERE id = $1
       UNION ALL
       SELECT i.id, i.status, i.duplicate_of_id, c.depth + 1
       FROM incidents i JOIN chain c ON i.id = c.duplicate_of_id
       WHERE c.status = 'DUPLICATE' AND c.depth < 5
     )
     SELECT id, status FROM chain ORDER BY depth DESC LIMIT 1`,
    [incidentId],
  )) as Array<{ id: string; status: IncidentStatus }>;
  if (rows.length === 0) return { id: incidentId, status: 'SUBMITTED' };
  return rows[0];
}

export async function resolveDispatchAgg(
  ds: DataSource,
  incidentId: string,
): Promise<DispatchStatusAgg> {
  const rows = (await ds.query(
    `SELECT
       COALESCE(BOOL_OR(status IN ('OFFERED','ACCEPTED')), false) AS offered,
       COALESCE(BOOL_OR(status = 'EN_ROUTE'), false) AS en_route,
       COALESCE(BOOL_OR(status = 'ON_SCENE'), false) AS on_scene
     FROM dispatches WHERE incident_id = $1`,
    [incidentId],
  )) as Array<{ offered: boolean; en_route: boolean; on_scene: boolean }>;
  return {
    offeredOrAccepted: Boolean(rows[0]?.offered),
    enRoute: Boolean(rows[0]?.en_route),
    onScene: Boolean(rows[0]?.on_scene),
  };
}

/** `publicStatus` (REST §4.2) untuk satu insiden — termasuk rantai DUPLICATE. */
export async function resolvePublicStatus(
  ds: DataSource,
  incidentId: string,
): Promise<PublicStatus> {
  const leaf = await resolveLeafIncident(ds, incidentId);
  const agg = await resolveDispatchAgg(ds, leaf.id);
  return computePublicStatus(leaf.status, agg);
}

/**
 * Versi batch `resolvePublicStatus` untuk daftar (tanpa N+1): rantai DUPLICATE
 * diselesaikan per incident, lalu agregat dispatch dihitung untuk incident induknya.
 */
export async function resolvePublicStatuses(
  ds: Pick<DataSource, 'query'>,
  incidentIds: string[],
): Promise<Map<string, PublicStatus>> {
  const out = new Map<string, PublicStatus>();
  const ids = [...new Set(incidentIds)];
  if (ids.length === 0) return out;
  const rows = (await ds.query(
    `WITH RECURSIVE chain AS (
       SELECT id AS origin, id, status, duplicate_of_id, 0 AS depth FROM incidents WHERE id = ANY($1::uuid[])
       UNION ALL
       SELECT c.origin, i.id, i.status, i.duplicate_of_id, c.depth + 1
         FROM incidents i JOIN chain c ON i.id = c.duplicate_of_id
        WHERE c.status = 'DUPLICATE' AND c.depth < 5
     ), leaf AS (
       SELECT DISTINCT ON (origin) origin, id, status FROM chain ORDER BY origin, depth DESC
     )
     SELECT l.origin, l.status,
            COALESCE(BOOL_OR(d.status IN ('OFFERED','ACCEPTED')), false) AS offered,
            COALESCE(BOOL_OR(d.status = 'EN_ROUTE'), false) AS en_route,
            COALESCE(BOOL_OR(d.status = 'ON_SCENE'), false) AS on_scene
       FROM leaf l LEFT JOIN dispatches d ON d.incident_id = l.id
      GROUP BY l.origin, l.status`,
    [ids],
  )) as Array<{ origin: string; status: IncidentStatus; offered: boolean; en_route: boolean; on_scene: boolean }>;
  for (const r of rows) {
    out.set(r.origin, computePublicStatus(r.status, { offeredOrAccepted: r.offered, enRoute: r.en_route, onScene: r.on_scene }));
  }
  return out;
}
