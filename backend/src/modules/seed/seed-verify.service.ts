import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors/app-error';
import { ClockService } from '../../common/clock/clock.service';
import { IncidentType, Region, SystemSetting } from '../../database/entities';
import { PasswordService } from '../auth/providers/password.service';
import { RegionLookupService } from '../me/region-lookup.service';
import { TopicNamingService } from '../me/topic-naming.service';
import { ReferenceService } from '../reference/reference.service';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS } from '../permissions/permissions.catalog';
import { SeedService } from './seed.service';
import { DEMO_PASSWORD, SETTING_KEYS, SPEC_STAFF_PHONES } from './seed-data';

type Check = { code: string; name: string; ok: boolean; detail?: string };

const REAL_EMERGENCY_NUMBERS = ['112', '110', '113', '118', '119'];

/**
 * `seed:verify` (seed §12): V1-V11 dengan pemeriksaan nyata terhadap basis data,
 * bukan nilai yang dipatok. Keluar gagal (exit code 1) bila ada pemeriksaan gagal.
 */
export class SeedVerifyService {
  private readonly passwords = new PasswordService();

  constructor(private readonly ds: DataSource) {}

  private async count(sql: string, params?: unknown[]): Promise<number> {
    const rows = await this.ds.query<Array<{ n: number }>>(sql, params);
    return Number(rows[0]?.n ?? 0);
  }

  private async countRows(table: string): Promise<number> {
    return this.count(`SELECT count(*)::int AS n FROM ${table}`);
  }

  async verify(): Promise<boolean> {
    const checks: Check[] = [];
    const add = (code: string, name: string, ok: boolean, detail?: string) =>
      checks.push({ code, name, ok, detail });

    // ---- V1: jumlah entitas dasar ----
    const regionsTotal = await this.countRows('regions');
    const cities = await this.count(`SELECT count(*)::int AS n FROM regions WHERE level = 'CITY'`);
    const districts = await this.count(`SELECT count(*)::int AS n FROM regions WHERE level = 'DISTRICT'`);
    const villages = await this.count(`SELECT count(*)::int AS n FROM regions WHERE level = 'VILLAGE'`);
    const orgs = await this.countRows('organizations');
    const units = await this.countRows('units');
    const roles = await this.countRows('roles');
    const incidentTypes = await this.countRows('incident_types');
    const staff = await this.count(`SELECT count(*)::int AS n FROM users WHERE user_type = 'STAFF'`);
    const citizens = await this.count(`SELECT count(*)::int AS n FROM users WHERE user_type = 'CITIZEN'`);
    const v1Expected = { regions: 10, organizations: 7, units: 12, roles: 7, incident_types: 5, staff: 21, citizens: 4 };
    const v1Actual = {
      regions: regionsTotal,
      organizations: orgs,
      units,
      roles,
      incident_types: incidentTypes,
      staff,
      citizens,
    };
    const v1Parts = Object.entries(v1Expected).map(([k, v]) => `${k}=${v1Actual[k as keyof typeof v1Actual]}/${v}`);
    add(
      'V1',
      'jumlah entitas dasar',
      regionsTotal === v1Expected.regions &&
        cities === 1 &&
        districts === 3 &&
        villages === 6 &&
        orgs === v1Expected.organizations &&
        units === v1Expected.units &&
        roles === v1Expected.roles &&
        incidentTypes === v1Expected.incident_types &&
        staff === v1Expected.staff &&
        citizens === v1Expected.citizens,
      v1Parts.join(', '),
    );

    // ---- V2: geometri wilayah ----
    const invalidBoundary = await this.count(
      `SELECT count(*)::int AS n FROM regions WHERE boundary IS NULL OR NOT ST_IsValid(boundary::geometry)`,
    );
    const outsideParent = await this.count(
      `SELECT count(*)::int AS n FROM regions c
       LEFT JOIN regions p ON p.id = c.parent_id
       WHERE c.level <> 'CITY'
         AND (p.id IS NULL OR p.boundary IS NULL OR NOT ST_Covers(p.boundary::geometry, c.boundary::geometry))`,
    );
    const siblingOverlap = await this.count(
      `SELECT count(*)::int AS n FROM regions a
       JOIN regions b ON a.parent_id = b.parent_id AND a.id < b.id
       WHERE ST_Overlaps(a.boundary::geometry, b.boundary::geometry)`,
    );
    add(
      'V2',
      'geometri wilayah',
      invalidBoundary === 0 && outsideParent === 0 && siblingOverlap === 0,
      `invalid=${invalidBoundary}, di luar induk=${outsideParent}, tumpang tindih=${siblingOverlap}`,
    );

    // ---- V3: lokasi organisasi & unit di dalam kota ----
    const orgOutside = await this.count(
      `SELECT count(*)::int AS n FROM organizations o
       CROSS JOIN (SELECT boundary::geometry AS g FROM regions WHERE level = 'CITY' LIMIT 1) c
       WHERE o.location IS NULL OR NOT ST_Covers(c.g, o.location::geometry)`,
    );
    const unitOutside = await this.count(
      `SELECT count(*)::int AS n FROM units u
       CROSS JOIN (SELECT boundary::geometry AS g FROM regions WHERE level = 'CITY' LIMIT 1) c
       WHERE u.last_location IS NULL OR NOT ST_Covers(c.g, u.last_location::geometry)`,
    );
    add('V3', 'lokasi organisasi & unit', orgOutside === 0 && unitOutside === 0, `org di luar=${orgOutside}, unit di luar/tanpa posisi=${unitOutside}`);

    // ---- V4: relasi ----
    const orgWithoutArea = await this.count(
      `SELECT count(*)::int AS n FROM organizations o
       WHERE NOT EXISTS (SELECT 1 FROM organization_service_areas s WHERE s.organization_id = o.id)`,
    );
    const staffWithoutProfile = await this.count(
      `SELECT count(*)::int AS n FROM users u
       WHERE u.user_type = 'STAFF'
         AND NOT EXISTS (SELECT 1 FROM staff_profiles p WHERE p.user_id = u.id)`,
    );
    const unitOrgMismatch = await this.count(
      `SELECT count(*)::int AS n FROM staff_profiles p
       JOIN units u ON u.id = p.unit_id
       WHERE u.organization_id <> p.organization_id`,
    );
    const commandNotInCc = await this.count(
      `SELECT count(*)::int AS n
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN users u ON u.id = ur.user_id
       JOIN staff_profiles p ON p.user_id = u.id
       JOIN organizations o ON o.id = p.organization_id
       WHERE r.code IN ('DISPATCHER', 'SUPERVISOR') AND o.code <> 'CC'`,
    );
    add(
      'V4',
      'relasi',
      orgWithoutArea === 0 && staffWithoutProfile === 0 && unitOrgMismatch === 0 && commandNotInCc === 0,
      `org tanpa wilayah=${orgWithoutArea}, staf tanpa profil=${staffWithoutProfile}, unit beda org=${unitOrgMismatch}, dispatcher/supervisor di luar CC=${commandNotInCc}`,
    );

    // ---- V5: permission ----
    const rolesWithoutPerm = await this.count(
      `SELECT count(*)::int AS n FROM roles r
       WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id)`,
    );
    const permsUnused = await this.count(
      `SELECT count(*)::int AS n FROM permissions p
       WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.permission_id = p.id)`,
    );
    const permTotal = await this.countRows('permissions');
    const dispatcherPii = await this.count(
      `SELECT count(*)::int AS n FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE r.code = 'DISPATCHER' AND p.code = 'pii.reveal_reporter'`,
    );
    const responderPii = await this.count(
      `SELECT count(*)::int AS n FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE r.code = 'RESPONDER' AND p.code = 'pii.reveal_reporter'`,
    );

    // Peta role di DB == katalog REST §3 (`ROLE_PERMISSIONS`)
    const mappingRows = await this.ds.query<{ role_code: string; codes: string[] | null }[]>(
      `SELECT r.code AS role_code,
              (SELECT array_agg(p.code ORDER BY p.code)
                 FROM role_permissions rp
                 JOIN permissions p ON p.id = rp.permission_id
                WHERE rp.role_id = r.id) AS codes
       FROM roles r`,
    );
    const dbMapping = new Map(mappingRows.map((row) => [row.role_code, [...(row.codes ?? [])].sort()]));
    const mappingMismatch: string[] = [];
    for (const [roleCode, expected] of Object.entries(ROLE_PERMISSIONS)) {
      const actual = dbMapping.get(roleCode) ?? [];
      const want = [...expected].sort();
      if (JSON.stringify(actual) !== JSON.stringify(want)) {
        mappingMismatch.push(`${roleCode}(${actual.length}/${want.length})`);
      }
    }
    for (const roleCode of dbMapping.keys()) {
      if (!(roleCode in ROLE_PERMISSIONS)) mappingMismatch.push(`${roleCode}+`);
    }

    const permissionCodesOk =
      (await this.count(
        `SELECT count(*)::int AS n FROM (SELECT unnest($1::text[]) AS code EXCEPT SELECT code FROM permissions) x`,
        [ALL_PERMISSIONS],
      )) === 0;
    add(
      'V5',
      'permission',
      rolesWithoutPerm === 0 &&
        permsUnused === 0 &&
        permissionCodesOk &&
        permTotal === ALL_PERMISSIONS.length &&
        dispatcherPii === 1 &&
        responderPii === 0 &&
        mappingMismatch.length === 0,
      `total=${permTotal}/${ALL_PERMISSIONS.length}, role tanpa izin=${rolesWithoutPerm}, izin tak terpakai=${permsUnused}, selisih katalog: ${mappingMismatch.join(' ') || '-'}`,
    );

    // ---- V6: login ----
    const staffRows = await this.ds.query<{ phone: string; password_hash: string | null; status: string }[]>(
      `SELECT phone, password_hash, status FROM users
       WHERE user_type = 'STAFF' AND phone = ANY($1::text[])
       ORDER BY phone`,
      [SPEC_STAFF_PHONES],
    );
    let badStaff = 0;
    for (const row of staffRows) {
      const okPass = await this.passwords.verify(DEMO_PASSWORD, row.password_hash);
      if (!okPass || row.status !== 'ACTIVE') badStaff += 1;
    }
    const citizenIssues = await this.count(
      `SELECT count(*)::int AS n FROM users
       WHERE user_type = 'CITIZEN'
         AND (password_hash IS NOT NULL OR phone_verified_at IS NULL OR status <> 'ACTIVE')`,
    );
    add(
      'V6',
      'login akun demo',
      staffRows.length === SPEC_STAFF_PHONES.length && badStaff === 0 && citizenIssues === 0,
      `staf terverifikasi=${staffRows.length - badStaff}/${SPEC_STAFF_PHONES.length}, warga bermasalah=${citizenIssues} (OTP mock 123456)`,
    );

    // ---- V7: konfigurasi publik ----
    try {
      const ref = new ReferenceService(
        this.ds.getRepository(IncidentType),
        this.ds.getRepository(Region),
        this.ds.getRepository(SystemSetting),
        new ClockService(),
        new RegionLookupService(this.ds.getRepository(Region)),
      );
      const cfg = await ref.getPublicConfig();
      const phones = (cfg.emergencyContacts ?? []).map((c) => String(c.phone));
      const settingsRows = await this.ds.query<Array<{ value: unknown }>>(
        `SELECT value FROM system_settings WHERE key = 'emergency_contacts'`,
      );
      const settingPhones = JSON.stringify(settingsRows[0]?.value ?? []).match(
        /"phone"\s*:\s*"([^"]+)"/g,
      );
      const settingPhoneValues = (settingPhones ?? []).map((m) => m.replace(/.*:"([^"]+)"/, '$1'));
      const hasRealNumber = [...phones, ...settingPhoneValues].some((p) =>
        REAL_EMERGENCY_NUMBERS.includes(p),
      );
      const missingSettings = SETTING_KEYS.length
        ? await this.count(
            `SELECT count(*)::int AS n FROM (SELECT unnest($1::text[]) AS key EXCEPT SELECT key FROM system_settings) x`,
            [SETTING_KEYS],
          )
        : 0;
      add(
        'V7',
        'konfigurasi publik',
        cfg.sampleMode === true &&
          phones.length > 0 &&
          !hasRealNumber &&
          missingSettings === 0 &&
          typeof cfg.serverTime === 'string' &&
          typeof cfg.operatingNow === 'boolean',
        `sampleMode=${cfg.sampleMode}, kontak=${phones.length}, nomor asli=${hasRealNumber ? 'ADA' : 'tidak ada'}, pengaturan hilang=${missingSettings}`,
      );
    } catch (err) {
      add('V7', 'konfigurasi publik', false, `galat: ${(err as Error).message}`);
    }

    // ---- V8: topic FCM ----
    const districtRows = await this.ds.query<{ code: string }[]>(
      `SELECT code FROM regions WHERE level = 'DISTRICT' ORDER BY code`,
    );
    const naming = new TopicNamingService(new ConfigService(process.env));
    const topics = [
      naming.city(),
      ...districtRows.map((r) => naming.district(r.code)),
      naming.staffAlerts(),
      naming.test(),
    ];
    const badTopics = topics.filter(
      (t) => !/^[a-zA-Z0-9_-]+$/.test(t) || t.length > 512 || t.startsWith('_') || t.endsWith('_'),
    );
    // Titik di Kel. Mawar harus menghasilkan kecamatan (tautan induk wilayah)
    // agar topic kecamatan dapat diturunkan untuk warga.
    const sampleResolve = await new RegionLookupService(this.ds.getRepository(Region)).resolve(
      112.69,
      -7.225,
    );
    add(
      'V8',
      'topic FCM',
      districtRows.length > 0 && badTopics.length === 0 && sampleResolve.district !== null,
      `${topics.length} topik: ${topics.join(', ')}; resolve sampel kecamatan=${sampleResolve.district?.code ?? 'null'}`,
    );

    // ---- V9: rekomendasi ambulans ----
    const nearest = await this.ds.query<Array<{ code: string }>>(
      `SELECT u.code
       FROM units u
       JOIN organizations o ON o.id = u.organization_id
       WHERE o.type = 'AMBULANCE_SERVICE'
         AND u.is_active AND u.status = 'AVAILABLE' AND u.last_location IS NOT NULL
       ORDER BY ST_Distance(
         u.last_location,
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) ASC
       LIMIT 1`,
      [112.73, -7.275],
    );
    add('V9', 'rekomendasi ambulans', nearest[0]?.code === 'AMB-02', `terdekat=${nearest[0]?.code ?? '-'}`);

    // ---- V10: idempotensi (seed:base dua kali tidak mengubah jumlah baris) ----
    const trackedTables = [
      'regions',
      'organizations',
      'organization_service_areas',
      'units',
      'incident_types',
      'roles',
      'permissions',
      'role_permissions',
      'users',
      'user_roles',
      'staff_profiles',
      'system_settings',
    ];
    const snapshot = async (): Promise<Record<string, number>> => {
      const out: Record<string, number> = {};
      for (const t of trackedTables) out[t] = await this.countRows(t);
      return out;
    };
    try {
      const before = await snapshot();
      await new SeedService(this.ds).base();
      const after = await snapshot();
      const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
      add('V10', 'idempotensi', changed.length === 0, changed.length === 0 ? 'jumlah baris identik' : `berubah: ${changed.join(', ')}`);
    } catch (err) {
      add('V10', 'idempotensi', false, `galat: ${(err as Error).message}`);
    }

    // ---- V11: penjaga lingkungan ----
    const previousEnv = process.env.ENV;
    process.env.ENV = 'prod';
    let rejected = false;
    let reason = '';
    try {
      await new SeedService(this.ds).base();
    } catch (err) {
      rejected = err instanceof AppError && err.code === 'FORBIDDEN';
      reason = rejected ? 'FORBIDDEN' : (err as Error).message;
    } finally {
      process.env.ENV = previousEnv;
    }
    add('V11', 'penjaga ENV=prod', rejected, rejected ? 'seed:base ditolak' : `tidak ditolak: ${reason}`);

    // ---- Hasil ----
    let ok = true;
    for (const c of checks) {
      if (!c.ok) ok = false;
      // eslint-disable-next-line no-console
      console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.code}.${c.name} — ${c.detail ?? ''}`);
    }
    return ok;
  }
}
