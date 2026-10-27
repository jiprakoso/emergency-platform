import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../common/errors/app-error';
import { PasswordService } from '../auth/providers/password.service';
import { ALL_PERMISSIONS, ROLE_NAMES, ROLE_PERMISSIONS } from '../permissions/permissions.catalog';
import {
  CITIZEN_ACCOUNTS,
  DEMO_PASSWORD,
  DISTRICT_CODES,
  INCIDENT_TYPES,
  LEGACY,
  ORGANIZATIONS,
  ORGANIZATION_CODES,
  REGIONS,
  SETTINGS,
  SPEC_CITIZEN_PHONES,
  SPEC_STAFF_PHONES,
  STAFF_ACCOUNTS,
  UNIT_CODES,
  UNITS,
} from './seed-data';

function isProd(): boolean {
  return process.env.ENV === 'prod' || process.env.NODE_ENV === 'production';
}

/** WKT MultiPolygon persegi dari bbox (lng,lat) sesuai seed §3. */
function polygonWkt(bbox: [number, number, number, number]): string {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return `MULTIPOLYGON(((${minLng} ${minLat}, ${maxLng} ${minLat}, ${maxLng} ${maxLat}, ${minLng} ${maxLat}, ${minLng} ${minLat})))`;
}

/**
 * `seed:base` (seed §2-§8): mengisi **dan menormalkan** data dasar demo terhadap
 * daftar pada dokumen seed. Idempoten (dijalankan dua kali tidak mengubah jumlah
 * baris — V10) dan ditolak bila `ENV=prod` (V11).
 *
 * Catatan normalisasi: akun/unit/jenis kejadian di luar daftar seed dihapus bila
 * tidak menjadi rujukan data domain; akun yang sudah menjadi rujukan dilewati
 * dengan peringatan agar data demo yang sudah terisi tidak rusak.
 */
export class SeedService {
  constructor(private readonly ds: DataSource) {}

  async base(): Promise<void> {
    if (isProd()) {
      throw AppError.forbidden('seed:base ditolak bila ENV=prod');
    }
    const passwords = new PasswordService();
    const demoHash = await passwords.hash(DEMO_PASSWORD);

    await this.ds.transaction(async (m) => {
      await this.seedRegions(m);
      await this.seedOrganizations(m);
      await this.seedUnits(m);
      await this.seedIncidentTypes(m);
      await this.seedRolesAndPermissions(m);
      await this.seedUsers(m, demoHash);
      await this.seedSettings(m);
    });
    // eslint-disable-next-line no-console
    console.log('seed:base selesai');
  }

  // ---- §3 Wilayah ----

  private async seedRegions(m: EntityManager): Promise<void> {
    const ids = new Map<string, string>();
    for (const r of REGIONS) {
      const [minLng, minLat, maxLng, maxLat] = r.bbox;
      await m.query(
        `INSERT INTO regions (parent_id, level, code, name, boundary, centroid, created_at, updated_at)
         VALUES ($1, $2, $3, $4,
           ST_SetSRID(ST_GeomFromText($5), 4326)::geography,
           ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
           now(), now())
         ON CONFLICT (code) DO UPDATE SET
           parent_id = EXCLUDED.parent_id,
           name = EXCLUDED.name,
           boundary = EXCLUDED.boundary,
           centroid = EXCLUDED.centroid,
           updated_at = now()`,
        [
          r.parent ? (ids.get(r.parent) ?? null) : null,
          r.level,
          r.code,
          r.name,
          polygonWkt(r.bbox),
          (minLng + maxLng) / 2,
          (minLat + maxLat) / 2,
        ],
      );
      const [row] = await m.query<{ id: string }[]>(`SELECT id FROM regions WHERE code = $1`, [r.code]);
      ids.set(r.code, row.id);
    }
  }

  // ---- §4 Organisasi, wilayah layanan, unit ----

  private async seedOrganizations(m: EntityManager): Promise<void> {
    // Iterasi seed lama memakai kode `AMB` (§4.1: `AMBULANS`).
    await m.query(
      `UPDATE organizations SET code = 'AMBULANS', updated_at = now()
       WHERE code = 'AMB'
         AND NOT EXISTS (SELECT 1 FROM organizations WHERE code = 'AMBULANS')`,
    );

    for (const o of ORGANIZATIONS) {
      await m.query(
        `INSERT INTO organizations (type, name, code, phone, location, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, true, now(), now())
         ON CONFLICT (code) DO UPDATE SET
           type = EXCLUDED.type,
           name = EXCLUDED.name,
           phone = EXCLUDED.phone,
           location = EXCLUDED.location,
           is_active = true,
           updated_at = now()`,
        [o.type, o.name, o.code, o.phone, o.lng, o.lat],
      );
    }

    for (const o of ORGANIZATIONS) {
      const areaCodes = o.serviceAreas === 'ALL_DISTRICTS' ? DISTRICT_CODES : o.serviceAreas;
      const [org] = await m.query<{ id: string }[]>(
        `SELECT id FROM organizations WHERE code = $1`,
        [o.code],
      );
      await m.query(`DELETE FROM organization_service_areas WHERE organization_id = $1`, [org.id]);
      await m.query(
        `INSERT INTO organization_service_areas (organization_id, region_id)
         SELECT $1, id FROM regions WHERE code = ANY($2::text[])
         ON CONFLICT DO NOTHING`,
        [org.id, areaCodes],
      );
      await m.query(
        `UPDATE organizations SET service_polygon = (
           SELECT ST_Multi(ST_Union(boundary::geometry))::geography
           FROM regions WHERE code = ANY($1::text[])
         ), updated_at = now()
         WHERE id = $2`,
        [areaCodes, org.id],
      );
    }

    // Organisasi di luar §4.1 dihapus bila tidak direferensikan.
    const stale = await m.query<{ id: string }[]>(
      `SELECT o.id FROM organizations o
       WHERE NOT (o.code = ANY($1::text[]))
         AND NOT EXISTS (SELECT 1 FROM units u WHERE u.organization_id = o.id)
         AND NOT EXISTS (SELECT 1 FROM staff_profiles p WHERE p.organization_id = o.id)
         AND NOT EXISTS (SELECT 1 FROM dispatches d WHERE d.organization_id = o.id)`,
      [ORGANIZATION_CODES],
    );
    if (stale.length > 0) {
      const ids = stale.map((s) => s.id);
      await m.query(
        `DELETE FROM organization_service_areas WHERE organization_id = ANY($1::uuid[])`,
        [ids],
      );
      await m.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [ids]);
    }
  }

  private async seedUnits(m: EntityManager): Promise<void> {
    for (const u of UNITS) {
      const [org] = await m.query<{ id: string }[]>(
        `SELECT id FROM organizations WHERE code = $1`,
        [u.orgCode],
      );
      const [existing] = await m.query<{ id: string; last_location: string | null }[]>(
        `SELECT id, last_location FROM units WHERE code = $1`,
        [u.code],
      );
      if (existing) {
        // Status dan posisi tidak ditimpa agar keadaan demo berjalan tidak terganggu;
        // posisi diisi hanya bila belum ada.
        await m.query(
          `UPDATE units SET
             organization_id = $1,
             name = $2,
             unit_type = $3,
             is_active = true,
             last_location = COALESCE(last_location, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography),
             last_location_at = COALESCE(last_location_at, now()),
             updated_at = now()
           WHERE id = $6`,
          [org.id, u.name, u.unitType, u.lng, u.lat, existing.id],
        );
      } else {
        await m.query(
          `INSERT INTO units (organization_id, code, name, unit_type, status, last_location, last_location_at, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'AVAILABLE',
             ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, now(), true, now(), now())`,
          [org.id, u.code, u.name, u.unitType, u.lng, u.lat],
        );
      }
    }

    const stale = await m.query<{ id: string; code: string }[]>(
      `SELECT id, code FROM units WHERE NOT (code = ANY($1::text[]))`,
      [UNIT_CODES],
    );
    if (stale.length > 0) {
      const ids = stale.map((s) => s.id);
      const blocked = await m.query<{ id: string; code: string }[]>(
        `SELECT u.id, u.code FROM units u
         WHERE u.id = ANY($1::uuid[])
           AND (EXISTS (SELECT 1 FROM staff_profiles p WHERE p.unit_id = u.id)
             OR EXISTS (SELECT 1 FROM dispatches d WHERE d.unit_id = u.id))`,
        [ids],
      );
      const blockedIds = new Set(blocked.map((b) => b.id));
      const free = ids.filter((id) => !blockedIds.has(id));
      if (free.length > 0) {
        await m.query(`DELETE FROM units WHERE id = ANY($1::uuid[])`, [free]);
      }
      if (blocked.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `seed: unit di luar daftar §4.2 dilewati (masih direferensikan): ${blocked
            .map((b) => b.code)
            .join(', ')}`,
        );
      }
    }
  }

  // ---- §7 Jenis kejadian ----

  private async seedIncidentTypes(m: EntityManager): Promise<void> {
    for (const [from, to] of LEGACY.incidentTypeRename) {
      await m.query(
        `UPDATE incident_types SET code = $1, updated_at = now()
         WHERE code = $2 AND NOT EXISTS (SELECT 1 FROM incident_types WHERE code = $3)`,
        [to, from, to],
      );
    }

    for (const t of INCIDENT_TYPES) {
      await m.query(
        `INSERT INTO incident_types
           (code, name, category, default_lead_org_type, suggested_resources, allows_condition_report, is_active, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, true, $7, now(), now())
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           default_lead_org_type = EXCLUDED.default_lead_org_type,
           suggested_resources = EXCLUDED.suggested_resources,
           allows_condition_report = EXCLUDED.allows_condition_report,
           is_active = true,
           sort_order = EXCLUDED.sort_order,
           updated_at = now()`,
        [
          t.code,
          t.name,
          t.category,
          t.defaultLeadOrgType,
          JSON.stringify(t.suggestedResources),
          t.allowsConditionReport,
          t.sortOrder,
        ],
      );
    }

    const stale = await m.query<{ id: string; code: string }[]>(
      `SELECT id, code FROM incident_types WHERE NOT (code = ANY($1::text[]))`,
      [INCIDENT_TYPES.map((t) => t.code)],
    );
    if (stale.length > 0) {
      const ids = stale.map((s) => s.id);
      const blocked = await m.query<{ code: string }[]>(
        `SELECT t.code FROM incident_types t
         WHERE t.id = ANY($1::uuid[])
           AND (EXISTS (SELECT 1 FROM incidents i WHERE i.type_id = t.id)
             OR EXISTS (SELECT 1 FROM incident_reports r WHERE r.type_id = t.id))`,
        [ids],
      );
      const blockedCodes = new Set(blocked.map((b) => b.code));
      const free = stale.filter((s) => !blockedCodes.has(s.code)).map((s) => s.id);
      if (free.length > 0) {
        await m.query(`DELETE FROM incident_types WHERE id = ANY($1::uuid[])`, [free]);
      }
      if (blocked.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `seed: jenis kejadian di luar daftar §7 dilewati (sudah dipakai): ${blocked
            .map((b) => b.code)
            .join(', ')}`,
        );
      }
    }
  }

  // ---- §5 Role dan permission ----

  private async seedRolesAndPermissions(m: EntityManager): Promise<void> {
    for (const [code, name] of Object.entries(ROLE_NAMES)) {
      await m.query(
        `INSERT INTO roles (code, name, created_at, updated_at) VALUES ($1, $2, now(), now())
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
        [code, name],
      );
    }

    // Katalog REST §3 (`permissions.catalog.ts`) adalah sumber kebenaran:
    // peta role dibangun ulang agar tidak ada kode di luar katalog (V5).
    await m.query(`DELETE FROM role_permissions`);
    await m.query(`DELETE FROM permissions`);
    for (const code of ALL_PERMISSIONS) {
      await m.query(
        `INSERT INTO permissions (code, created_at, updated_at) VALUES ($1, now(), now())
         ON CONFLICT (code) DO NOTHING`,
        [code],
      );
    }
    for (const [roleCode, codes] of Object.entries(ROLE_PERMISSIONS)) {
      const [role] = await m.query<{ id: string }[]>(`SELECT id FROM roles WHERE code = $1`, [roleCode]);
      if (!role) continue;
      for (const code of codes) {
        const [perm] = await m.query<{ id: string }[]>(
          `SELECT id FROM permissions WHERE code = $1`,
          [code],
        );
        if (!perm) continue;
        await m.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [role.id, perm.id],
        );
      }
    }
  }

  // ---- §6 Akun demo ----

  private async seedUsers(m: EntityManager, demoHash: string): Promise<void> {
    const specPhones = [...SPEC_STAFF_PHONES, ...SPEC_CITIZEN_PHONES];

    // Akun di luar daftar §6 dihapus bila belum menjadi rujukan data domain.
    const doomed = await m.query<{ id: string; phone: string }[]>(
      `SELECT id, phone FROM users u
       WHERE NOT (u.phone = ANY($1::text[]))
         AND NOT EXISTS (SELECT 1 FROM incident_reports r WHERE r.reporter_id = u.id OR r.entered_by = u.id)
         AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.locked_by = u.id OR i.verified_by = u.id)
         AND NOT EXISTS (SELECT 1 FROM dispatches d WHERE d.created_by = u.id OR d.accepted_by = u.id OR d.recorded_by = u.id)
         AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.uploaded_by = u.id)
         AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.actor_user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM dispatcher_shifts s WHERE s.user_id = u.id)`,
      [specPhones],
    );
    if (doomed.length > 0) {
      await m.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [doomed.map((d) => d.id)]);
      // eslint-disable-next-line no-console
      console.warn(
        `seed: akun di luar daftar §6 dihapus: ${doomed.map((d) => d.phone).join(', ')}`,
      );
    }

    for (const s of STAFF_ACCOUNTS) {
      const [org] = await m.query<{ id: string }[]>(
        `SELECT id FROM organizations WHERE code = $1`,
        [s.orgCode],
      );
      const unit = s.unitCode
        ? await m.query<{ id: string }[]>(`SELECT id FROM units WHERE code = $1`, [s.unitCode])
        : [];
      const unitId = unit[0]?.id ?? null;

      const [existing] = await m.query<{ id: string }[]>(
        `SELECT id FROM users WHERE phone = $1`,
        [s.phone],
      );
      let userId: string;
      if (existing) {
        userId = existing.id;
        // Kata sandi di-upgrade ke Argon2 bila masih bcrypt/NULL (handoff §9.5).
        await m.query(
          `UPDATE users SET
             user_type = 'STAFF',
             full_name = $1,
             email = $2,
             phone_verified_at = COALESCE(phone_verified_at, now()),
             password_hash = CASE
               WHEN password_hash IS NULL OR password_hash LIKE '$2%' THEN $3
               ELSE password_hash END,
             two_factor_enabled = false,
             two_factor_secret = NULL,
             must_change_password = false,
             status = 'ACTIVE',
             updated_at = now()
           WHERE id = $4`,
          [s.fullName, s.email, demoHash, userId],
        );
      } else {
        const [created] = await m.query<{ id: string }[]>(
          `INSERT INTO users
             (user_type, full_name, phone, phone_verified_at, email, password_hash,
              two_factor_enabled, two_factor_secret, must_change_password, status,
              reputation_score, created_at, updated_at)
           VALUES ('STAFF', $1, $2, now(), $3, $4, false, null, false, 'ACTIVE', 0, now(), now())
           RETURNING id`,
          [s.fullName, s.phone, s.email, demoHash],
        );
        userId = created.id;
      }

      await m.query(
        `INSERT INTO staff_profiles (user_id, organization_id, unit_id, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, true, now(), now())
         ON CONFLICT (user_id) DO UPDATE SET
           organization_id = EXCLUDED.organization_id,
           unit_id = EXCLUDED.unit_id,
           is_active = true,
           updated_at = now()`,
        [userId, org.id, unitId],
      );
      await this.replaceUserRoles(m, userId, s.roles);
    }

    for (const c of CITIZEN_ACCOUNTS) {
      const [region] = await m.query<{ id: string }[]>(
        `SELECT id FROM regions WHERE code = $1`,
        [c.homeRegionCode],
      );
      const [existing] = await m.query<{ id: string }[]>(
        `SELECT id FROM users WHERE phone = $1`,
        [c.phone],
      );
      let userId: string;
      if (existing) {
        userId = existing.id;
        await m.query(
          `UPDATE users SET
             user_type = 'CITIZEN',
             full_name = $1,
             email = NULL,
             phone_verified_at = COALESCE(phone_verified_at, now()),
             password_hash = NULL,
             two_factor_enabled = false,
             two_factor_secret = NULL,
             must_change_password = false,
             status = 'ACTIVE',
             reputation_score = $2,
             home_region_id = $3,
             home_location = ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
             updated_at = now()
           WHERE id = $6`,
          [c.fullName, c.reputationScore, region.id, c.lng, c.lat, userId],
        );
      } else {
        const [created] = await m.query<{ id: string }[]>(
          `INSERT INTO users
             (user_type, full_name, phone, phone_verified_at, email, password_hash,
              two_factor_enabled, two_factor_secret, must_change_password, status,
              reputation_score, home_region_id, home_location, created_at, updated_at)
           VALUES ('CITIZEN', $1, $2, now(), NULL, NULL, false, null, false, 'ACTIVE',
             $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, now(), now())
           RETURNING id`,
          [c.fullName, c.phone, c.reputationScore, region.id, c.lng, c.lat],
        );
        userId = created.id;
      }
      await this.replaceUserRoles(m, userId, ['CITIZEN']);
    }
  }

  private async replaceUserRoles(
    m: EntityManager,
    userId: string,
    roleCodes: string[],
  ): Promise<void> {
    await m.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
    for (const code of roleCodes) {
      const [role] = await m.query<{ id: string }[]>(`SELECT id FROM roles WHERE code = $1`, [code]);
      if (!role) throw AppError.internal(`Role ${code} tidak ditemukan saat seed.`);
      await m.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, role.id],
      );
    }
  }

  // ---- §8 Pengaturan sistem ----

  private async seedSettings(m: EntityManager): Promise<void> {
    for (const [key, value] of SETTINGS) {
      await m.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    }
  }

  // ---- Pembersihan data operasional ----

  async resetLive(): Promise<void> {
    await this.ds.transaction(async (m) => {
      const tables = [
        'notification_deliveries',
        'notifications',
        'outbox_events',
        'incident_events',
        'audit_logs',
        'incident_reports',
        'dispatch_status_history',
        'dispatches',
        'resource_requests',
        'incident_casualties',
        'attachments',
        'incidents',
        'disaster_alert_regions',
        'disaster_alerts',
        'device_topic_subscriptions',
        'device_tokens',
        'auth_sessions',
        'otp_requests',
        'dispatcher_shifts',
      ];
      for (const t of tables) {
        try {
          await m.query(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`);
        } catch {
          // tabel belum ada (tahap awal) — abaikan
        }
      }
    });
    // eslint-disable-next-line no-console
    console.log('seed:reset-live selesai (data dasar dipertahankan)');
  }
}
