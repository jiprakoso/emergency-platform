import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_NAMES,
  ROLE_PERMISSIONS,
} from './permissions.catalog';

/**
 * Matriks permission (REST §3) — sumber kebenaran seed dan penegakan akses.
 * Membaca ulang kontrak: jumlah izin, keunikan, cakupan role, dan izin yang
 * tidak boleh dimiliki role tertentu (kerahasiaan PII pelapor).
 */
describe('permissions.catalog (matriks role → izin)', () => {
  const roleCodes = Object.keys(ROLE_PERMISSIONS);

  it('memuat 38 kode izin unik sesuai katalog REST §3', () => {
    expect(ALL_PERMISSIONS).toHaveLength(38);
    expect(new Set(ALL_PERMISSIONS).size).toBe(38);
    ALL_PERMISSIONS.forEach((code) => expect(code).toMatch(/^[a-z_]+\.[a-z_]+$/));
  });

  it('menyediakan nama untuk setiap role dan tidak ada role bayangan', () => {
    expect(Object.keys(ROLE_NAMES).sort()).toEqual([...roleCodes].sort());
    expect(roleCodes).toHaveLength(7);
  });

  it('setiap role hanya memakai izin katalog, tanpa duplikat', () => {
    for (const codes of Object.values(ROLE_PERMISSIONS)) {
      expect(new Set(codes).size).toBe(codes.length);
      for (const code of codes) expect(ALL_PERMISSIONS).toContain(code);
    }
  });

  it('mendistribusikan seluruh izin (tidak ada izin tak terpakai)', () => {
    const used = new Set(roleCodes.flatMap((role) => ROLE_PERMISSIONS[role]));
    expect([...used].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('menjaga jumlah izin per role sesuai matriks', () => {
    expect(ROLE_PERMISSIONS.CITIZEN).toHaveLength(2);
    expect(ROLE_PERMISSIONS.RESPONDER).toHaveLength(7);
    expect(ROLE_PERMISSIONS.ORG_ADMIN).toHaveLength(3);
    expect(ROLE_PERMISSIONS.ALERT_MANAGER).toHaveLength(3);
    expect(ROLE_PERMISSIONS.DISPATCHER).toHaveLength(23);
    expect(ROLE_PERMISSIONS.SUPERVISOR).toHaveLength(25);
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toHaveLength(7);
  });

  it('SUPERVISOR melampaui DISPATCHER (matriks naik, bukan cabang)', () => {
    const supervisor = new Set(ROLE_PERMISSIONS.SUPERVISOR);
    // Seluruh izin dispatcher dimiliki supervisor.
    ROLE_PERMISSIONS.DISPATCHER.forEach((code) => expect(supervisor.has(code)).toBe(true));
    expect(ROLE_PERMISSIONS.SUPERVISOR).toContain(PERMISSIONS.INCIDENT_LOCK_OVERRIDE);
    expect(ROLE_PERMISSIONS.DISPATCHER).not.toContain(PERMISSIONS.INCIDENT_LOCK_OVERRIDE);
    expect(ROLE_PERMISSIONS.SUPERVISOR).toHaveLength(
      ROLE_PERMISSIONS.DISPATCHER.length + 2,
    );
  });

  it('warga dan responder tidak melihat data PII/insiden penuh', () => {
    const forbidden: string[] = [
      PERMISSIONS.PII_REVEAL_REPORTER,
      PERMISSIONS.INCIDENT_READ_ALL,
      PERMISSIONS.SETTINGS_MANAGE,
    ];
    for (const role of ['CITIZEN', 'RESPONDER'] as const) {
      for (const code of forbidden) {
        expect(ROLE_PERMISSIONS[role]).not.toContain(code);
      }
    }
    expect(ROLE_PERMISSIONS.RESPONDER).toContain(PERMISSIONS.INCIDENT_READ_RELATED);
    expect(ROLE_PERMISSIONS.CITIZEN).toEqual([
      PERMISSIONS.REPORT_CREATE,
      PERMISSIONS.REPORT_READ_OWN,
    ]);
  });

  it('hanya SUPER_ADMIN yang mengelola role dan pengaturan global', () => {
    for (const role of roleCodes.filter((r) => r !== 'SUPER_ADMIN')) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(PERMISSIONS.ROLE_MANAGE);
      expect(ROLE_PERMISSIONS[role]).not.toContain(PERMISSIONS.SETTINGS_MANAGE);
      expect(ROLE_PERMISSIONS[role]).not.toContain(PERMISSIONS.ORG_MANAGE_ALL);
    }
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toEqual(
      expect.arrayContaining([
        PERMISSIONS.ROLE_MANAGE,
        PERMISSIONS.SETTINGS_MANAGE,
        PERMISSIONS.ORG_MANAGE_ALL,
        PERMISSIONS.AUDIT_READ_ALL,
      ]),
    );
    // Audit organisasi sendiri = ORG_ADMIN; audit lintas organisasi = jenjang
    // supervisor ke atas; SUPER_ADMIN tidak memakai varian terbatas.
    expect(ROLE_PERMISSIONS.ORG_ADMIN).toContain(PERMISSIONS.AUDIT_READ_OWN_ORG);
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).not.toContain(PERMISSIONS.AUDIT_READ_OWN_ORG);
    expect(ROLE_PERMISSIONS.SUPERVISOR).toContain(PERMISSIONS.AUDIT_READ_ALL);
    for (const role of [
      'CITIZEN',
      'RESPONDER',
      'ORG_ADMIN',
      'ALERT_MANAGER',
      'DISPATCHER',
    ]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(PERMISSIONS.AUDIT_READ_ALL);
    }
  });
});
