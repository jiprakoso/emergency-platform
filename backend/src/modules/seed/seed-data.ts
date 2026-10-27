/**
 * Data seed demo — sumber: `docs/specs/seed-demo-aplikasi-darurat.md` §3-§8.
 *
 * - Nomor telepon, nomor darurat, dan nama adalah **data contoh** (bukan data nyata).
 * - Koordinat dalam `(lat, lng)` untuk kode TS; konversi ke PostGIS `(lng, lat)`
 *   dilakukan saat pembuatan SQL (lihat `seed.service.ts`).
 */

export const DEMO_PASSWORD = 'Contoh#2026';

type BBox = [minLng: number, minLat: number, maxLng: number, maxLat: number];

export type RegionSeed = {
  code: string;
  name: string;
  level: 'CITY' | 'DISTRICT' | 'VILLAGE';
  parent: string | null;
  bbox: BBox;
};

/** §3: Kota Contoh + 3 kecamatan + 6 kelurahan (persegi sederhana). */
export const REGIONS: RegionSeed[] = [
  { code: '99.99', name: 'Kota Contoh', level: 'CITY', parent: null, bbox: [112.65, -7.35, 112.8, -7.2] },
  { code: '99.99.01', name: 'Kec. Sinar', level: 'DISTRICT', parent: '99.99', bbox: [112.65, -7.25, 112.8, -7.2] },
  { code: '99.99.02', name: 'Kec. Bukit', level: 'DISTRICT', parent: '99.99', bbox: [112.65, -7.3, 112.8, -7.25] },
  { code: '99.99.03', name: 'Kec. Muara', level: 'DISTRICT', parent: '99.99', bbox: [112.65, -7.35, 112.8, -7.3] },
  { code: '99.99.01.1001', name: 'Kel. Mawar', level: 'VILLAGE', parent: '99.99.01', bbox: [112.65, -7.25, 112.725, -7.2] },
  { code: '99.99.01.1002', name: 'Kel. Melati', level: 'VILLAGE', parent: '99.99.01', bbox: [112.725, -7.25, 112.8, -7.2] },
  { code: '99.99.02.1001', name: 'Kel. Anggrek', level: 'VILLAGE', parent: '99.99.02', bbox: [112.65, -7.3, 112.725, -7.25] },
  { code: '99.99.02.1002', name: 'Kel. Kenanga', level: 'VILLAGE', parent: '99.99.02', bbox: [112.725, -7.3, 112.8, -7.25] },
  { code: '99.99.03.1001', name: 'Kel. Pesisir', level: 'VILLAGE', parent: '99.99.03', bbox: [112.65, -7.35, 112.725, -7.3] },
  { code: '99.99.03.1002', name: 'Kel. Nelayan', level: 'VILLAGE', parent: '99.99.03', bbox: [112.725, -7.35, 112.8, -7.3] },
];

export const REGION_CODES = REGIONS.map((r) => r.code);
export const DISTRICT_CODES = REGIONS.filter((r) => r.level === 'DISTRICT').map((r) => r.code);

export type OrganizationSeed = {
  code: string;
  type: string;
  name: string;
  lat: number;
  lng: number;
  phone: string;
  /** `true` = seluruh kecamatan. */
  serviceAreas: 'ALL_DISTRICTS' | string[];
};

/** §4.1: 7 organisasi beserta lokasi, telepon contoh, dan wilayah layanan. */
export const ORGANIZATIONS: OrganizationSeed[] = [
  { code: 'CC', type: 'COMMAND_CENTER', name: 'Pusat Komando Kota Contoh', lat: -7.265, lng: 112.725, phone: '000-0000-0001', serviceAreas: 'ALL_DISTRICTS' },
  { code: 'POLRES', type: 'POLICE', name: 'Polres Kota Contoh', lat: -7.27, lng: 112.7, phone: '000-0000-0010', serviceAreas: 'ALL_DISTRICTS' },
  { code: 'DAMKAR', type: 'FIRE', name: 'Dinas Pemadam Kebakaran Kota Contoh', lat: -7.28, lng: 112.76, phone: '000-0000-0020', serviceAreas: 'ALL_DISTRICTS' },
  { code: 'RSUD', type: 'HOSPITAL', name: 'RSUD Kota Contoh', lat: -7.285, lng: 112.74, phone: '000-0000-0030', serviceAreas: ['99.99.01', '99.99.02'] },
  { code: 'RSPM', type: 'HOSPITAL', name: 'RS Pratama Muara', lat: -7.325, lng: 112.76, phone: '000-0000-0031', serviceAreas: ['99.99.03'] },
  { code: 'AMBULANS', type: 'AMBULANCE_SERVICE', name: 'Layanan Ambulans Kota Contoh', lat: -7.275, lng: 112.72, phone: '000-0000-0040', serviceAreas: 'ALL_DISTRICTS' },
  { code: 'BPBD', type: 'BPBD', name: 'BPBD Kota Contoh', lat: -7.29, lng: 112.68, phone: '000-0000-0050', serviceAreas: 'ALL_DISTRICTS' },
];

export const ORGANIZATION_CODES = ORGANIZATIONS.map((o) => o.code);

export type UnitSeed = {
  orgCode: string;
  code: string;
  unitType: string;
  name: string;
  lat: number;
  lng: number;
};

/** §4.2: 12 unit dengan posisi awal. */
export const UNITS: UnitSeed[] = [
  { orgCode: 'POLRES', code: 'PATROL-01', unitType: 'PATROL', name: 'Patroli 01', lat: -7.272, lng: 112.705 },
  { orgCode: 'POLRES', code: 'PATROL-02', unitType: 'PATROL', name: 'Patroli 02', lat: -7.32, lng: 112.74 },
  { orgCode: 'DAMKAR', code: 'DMK-01', unitType: 'FIRE_ENGINE', name: 'Mobil Pemadam Pos Utara', lat: -7.22, lng: 112.72 },
  { orgCode: 'DAMKAR', code: 'DMK-02', unitType: 'FIRE_ENGINE', name: 'Mobil Pemadam Pos Selatan', lat: -7.33, lng: 112.75 },
  { orgCode: 'DAMKAR', code: 'DMK-03', unitType: 'FIRE_ENGINE', name: 'Mobil Pemadam Pos Tengah', lat: -7.28, lng: 112.76 },
  { orgCode: 'AMBULANS', code: 'AMB-01', unitType: 'AMBULANCE', name: 'Ambulans 01 (Utara)', lat: -7.23, lng: 112.75 },
  { orgCode: 'AMBULANS', code: 'AMB-02', unitType: 'AMBULANCE', name: 'Ambulans 02 (Tengah)', lat: -7.275, lng: 112.72 },
  { orgCode: 'AMBULANS', code: 'AMB-03', unitType: 'AMBULANCE', name: 'Ambulans 03 (Selatan)', lat: -7.32, lng: 112.73 },
  { orgCode: 'RSUD', code: 'IGD-01', unitType: 'ER', name: 'IGD RSUD Kota Contoh', lat: -7.285, lng: 112.74 },
  { orgCode: 'RSPM', code: 'IGD-02', unitType: 'ER', name: 'IGD RS Pratama Muara', lat: -7.325, lng: 112.76 },
  { orgCode: 'BPBD', code: 'RESCUE-01', unitType: 'RESCUE_TEAM', name: 'Tim Reaksi Cepat 01', lat: -7.29, lng: 112.68 },
  { orgCode: 'BPBD', code: 'RESCUE-02', unitType: 'RESCUE_TEAM', name: 'Tim Reaksi Cepat 02', lat: -7.335, lng: 112.68 },
];

export const UNIT_CODES = UNITS.map((u) => u.code);

export type IncidentTypeSeed = {
  code: string;
  name: string;
  category: string;
  defaultLeadOrgType: string | null;
  allowsConditionReport: boolean;
  sortOrder: number;
  suggestedResources: unknown[];
};

/** §7: 5 jenis kejadian termasuk `suggested_resources`. */
export const INCIDENT_TYPES: IncidentTypeSeed[] = [
  {
    code: 'TRAFFIC_ACCIDENT',
    name: 'Kecelakaan Lalu Lintas',
    category: 'TRAFFIC',
    defaultLeadOrgType: 'POLICE',
    allowsConditionReport: false,
    sortOrder: 1,
    suggestedResources: [
      { org_type: 'AMBULANCE_SERVICE', dispatch_type: 'RESPOND', required: true },
      { org_type: 'POLICE', dispatch_type: 'RESPOND', required: true },
      { org_type: 'FIRE', dispatch_type: 'RESPOND', required: false, hint: 'Aktifkan bila korban terjebak atau ada kebocoran BBM' },
    ],
  },
  {
    code: 'FIRE',
    name: 'Kebakaran',
    category: 'FIRE',
    defaultLeadOrgType: 'FIRE',
    allowsConditionReport: false,
    sortOrder: 2,
    suggestedResources: [
      { org_type: 'FIRE', dispatch_type: 'RESPOND', required: true },
      { org_type: 'AMBULANCE_SERVICE', dispatch_type: 'RESPOND', required: false },
      { org_type: 'POLICE', dispatch_type: 'RESPOND', required: false },
    ],
  },
  {
    code: 'FLOOD',
    name: 'Banjir',
    category: 'NATURAL_DISASTER',
    defaultLeadOrgType: 'BPBD',
    allowsConditionReport: true,
    sortOrder: 3,
    suggestedResources: [
      { org_type: 'BPBD', dispatch_type: 'RESPOND', required: true },
      { org_type: 'AMBULANCE_SERVICE', dispatch_type: 'RESPOND', required: false },
    ],
  },
  {
    code: 'MEDICAL',
    name: 'Darurat Medis',
    category: 'MEDICAL',
    defaultLeadOrgType: 'AMBULANCE_SERVICE',
    allowsConditionReport: false,
    sortOrder: 4,
    suggestedResources: [{ org_type: 'AMBULANCE_SERVICE', dispatch_type: 'RESPOND', required: true }],
  },
  {
    code: 'OTHER',
    name: 'Lainnya',
    category: 'OTHER',
    defaultLeadOrgType: null,
    allowsConditionReport: false,
    sortOrder: 5,
    suggestedResources: [],
  },
];

export const INCIDENT_TYPE_CODES = INCIDENT_TYPES.map((t) => t.code);

export type StaffSeed = {
  email: string;
  phone: string;
  fullName: string;
  roles: string[];
  orgCode: string;
  unitCode?: string;
};

/** §6.1-6.2: 21 akun staf (kata sandi contoh sama untuk seluruhnya). */
export const STAFF_ACCOUNTS: StaffSeed[] = [
  { email: 'superadmin@contoh.test', phone: '0800-0000-1001', fullName: 'Super Admin', roles: ['SUPER_ADMIN'], orgCode: 'CC' },
  { email: 'supervisor@contoh.test', phone: '0800-0000-1002', fullName: 'Supervisor Hendra', roles: ['SUPERVISOR'], orgCode: 'CC' },
  { email: 'dispatcher1@contoh.test', phone: '0800-0000-1003', fullName: 'Dispatcher Rina', roles: ['DISPATCHER'], orgCode: 'CC' },
  { email: 'dispatcher2@contoh.test', phone: '0800-0000-1004', fullName: 'Dispatcher Agus', roles: ['DISPATCHER'], orgCode: 'CC' },
  { email: 'admin.polres@contoh.test', phone: '0800-0000-1011', fullName: 'Admin Polres', roles: ['ORG_ADMIN'], orgCode: 'POLRES' },
  { email: 'admin.damkar@contoh.test', phone: '0800-0000-1012', fullName: 'Admin Damkar', roles: ['ORG_ADMIN'], orgCode: 'DAMKAR' },
  { email: 'admin.rsud@contoh.test', phone: '0800-0000-1013', fullName: 'Admin RSUD', roles: ['ORG_ADMIN'], orgCode: 'RSUD' },
  { email: 'admin.ambulans@contoh.test', phone: '0800-0000-1014', fullName: 'Admin Ambulans', roles: ['ORG_ADMIN'], orgCode: 'AMBULANS' },
  { email: 'admin.bpbd@contoh.test', phone: '0800-0000-1015', fullName: 'Admin BPBD', roles: ['ORG_ADMIN', 'ALERT_MANAGER'], orgCode: 'BPBD' },
  { email: 'resp.patroli1@contoh.test', phone: '0800-0000-2001', fullName: 'Bripka Dedi', roles: ['RESPONDER'], orgCode: 'POLRES', unitCode: 'PATROL-01' },
  { email: 'resp.patroli2@contoh.test', phone: '0800-0000-2002', fullName: 'Bripka Eko', roles: ['RESPONDER'], orgCode: 'POLRES', unitCode: 'PATROL-02' },
  { email: 'resp.damkar1@contoh.test', phone: '0800-0000-2011', fullName: 'Petugas Fajar', roles: ['RESPONDER'], orgCode: 'DAMKAR', unitCode: 'DMK-01' },
  { email: 'resp.damkar2@contoh.test', phone: '0800-0000-2012', fullName: 'Petugas Gilang', roles: ['RESPONDER'], orgCode: 'DAMKAR', unitCode: 'DMK-02' },
  { email: 'resp.damkar3@contoh.test', phone: '0800-0000-2013', fullName: 'Petugas Hadi', roles: ['RESPONDER'], orgCode: 'DAMKAR', unitCode: 'DMK-03' },
  { email: 'resp.amb1@contoh.test', phone: '0800-0000-2021', fullName: 'Paramedis Indra', roles: ['RESPONDER'], orgCode: 'AMBULANS', unitCode: 'AMB-01' },
  { email: 'resp.amb2@contoh.test', phone: '0800-0000-2022', fullName: 'Paramedis Joko', roles: ['RESPONDER'], orgCode: 'AMBULANS', unitCode: 'AMB-02' },
  { email: 'resp.amb3@contoh.test', phone: '0800-0000-2023', fullName: 'Paramedis Kiki', roles: ['RESPONDER'], orgCode: 'AMBULANS', unitCode: 'AMB-03' },
  { email: 'resp.igd1@contoh.test', phone: '0800-0000-2031', fullName: 'Perawat Lina', roles: ['RESPONDER'], orgCode: 'RSUD', unitCode: 'IGD-01' },
  { email: 'resp.igd2@contoh.test', phone: '0800-0000-2032', fullName: 'Perawat Mira', roles: ['RESPONDER'], orgCode: 'RSPM', unitCode: 'IGD-02' },
  { email: 'resp.bpbd1@contoh.test', phone: '0800-0000-2041', fullName: 'Relawan Nanda', roles: ['RESPONDER'], orgCode: 'BPBD', unitCode: 'RESCUE-01' },
  { email: 'resp.bpbd2@contoh.test', phone: '0800-0000-2042', fullName: 'Relawan Oki', roles: ['RESPONDER'], orgCode: 'BPBD', unitCode: 'RESCUE-02' },
];

export type CitizenSeed = {
  phone: string;
  fullName: string;
  homeRegionCode: string;
  lat: number;
  lng: number;
  reputationScore: number;
};

/** §6.3: 4 akun warga (login lewat OTP mock `123456`). */
export const CITIZEN_ACCOUNTS: CitizenSeed[] = [
  { phone: '0812-0000-0001', fullName: 'Budi', homeRegionCode: '99.99.01.1001', lat: -7.225, lng: 112.69, reputationScore: 0 },
  { phone: '0812-0000-0002', fullName: 'Sari', homeRegionCode: '99.99.02.1001', lat: -7.275, lng: 112.68, reputationScore: 0 },
  { phone: '0812-0000-0003', fullName: 'Andi', homeRegionCode: '99.99.03.1001', lat: -7.33, lng: 112.7, reputationScore: 0 },
  { phone: '0812-0000-0004', fullName: 'Dewi', homeRegionCode: '99.99.03.1002', lat: -7.33, lng: 112.77, reputationScore: -5 },
];

export const SPEC_STAFF_PHONES = STAFF_ACCOUNTS.map((s) => s.phone);
export const SPEC_CITIZEN_PHONES = CITIZEN_ACCOUNTS.map((c) => c.phone);

/** §8: pengaturan sistem (nilai sampel). */
export const SETTINGS: Array<[string, unknown]> = [
  ['offer_timeout_seconds', 120],
  ['fcm.resend_after_seconds', 20],
  ['offer_unseen_seconds', 60],
  ['unhandled_incident_escalation_minutes', 3],
  ['auto_close_hours', 24],
  ['incident_lock_seconds', 300],
  ['fcm.stale_token_days', 60],
  ['fcm.max_tokens_per_user', 5],
  ['gps_accuracy_warn_m', 50],
  ['min_app_version', '1.0.0'],
  ['map_default', { lat: -7.275, lng: 112.725, zoom: 12 }],
  ['limits', { photo_max_mb: 10, video_max_mb: 50, max_attachments: 5 }],
  ['report_rate_limit', { help_request: { count: 3, window_min: 10, daily: 10 }, condition_report: { count: 10, window_min: 10 } }],
  ['alert_rate_limit', { per_hour_per_region: 5 }],
  ['operating_hours', { timezone: 'Asia/Jakarta', mode: '24x7' }],
  ['alert_levels', [
    { code: 'WASPADA', name: 'Waspada', fcm_class: 'INFO' },
    { code: 'SIAGA', name: 'Siaga', fcm_class: 'CRITICAL' },
    { code: 'AWAS', name: 'Awas', fcm_class: 'CRITICAL', require_typed_confirmation: true },
  ]],
  ['emergency_contacts', [
    { name: 'Darurat Terpadu (contoh)', phone: '000-112', note: 'Ganti dengan 112 pada produksi' },
    { name: 'Polisi (contoh)', phone: '000-110', note: 'Ganti dengan 110 pada produksi' },
    { name: 'Pemadam (contoh)', phone: '000-113', note: 'Ganti dengan 113 pada produksi' },
    { name: 'Ambulans (contoh)', phone: '000-118', note: 'Ganti dengan 118/119 pada produksi' },
    { name: 'BPBD (contoh)', phone: '000-050', note: 'Ganti dengan nomor BPBD setempat' },
  ]],
  ['disclaimer', 'Aplikasi ini bukan pengganti nomor darurat resmi. Untuk kondisi mengancam nyawa, hubungi nomor darurat langsung.'],
  ['sample_mode', true],
];

export const SETTING_KEYS = SETTINGS.map(([key]) => key);

/**
 * Baris warisan dari iterasi seed sebelumnya (bukan bagian seed §3-§8).
 * Dihapus/diubah saat `seed:base` agar data dasar konvergen ke spesifikasi.
 */
export const LEGACY = {
  /** Kode jenis kejadian lama (diganti `MEDICAL` sesuai §7). */
  incidentTypeRename: [['MEDICAL_EMERGENCY', 'MEDICAL']] as Array<[string, string]>,
};
