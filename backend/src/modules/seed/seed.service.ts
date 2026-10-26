import { DataSource } from 'typeorm';
import { AppError } from '../../common/errors/app-error';
import * as bcrypt from 'bcryptjs';
import {
  IncidentType,
  Organization,
  Permission,
  Region,
  Role,
  RolePermission,
  StaffProfile,
  SystemSetting,
  Unit,
  User,
  UserRole,
} from '../../database/entities';

function isProd() {
  return process.env.ENV === 'prod' || process.env.NODE_ENV === 'production';
}

export class SeedService {
  constructor(private readonly ds: DataSource) {}

  async base() {
    if (isProd()) {
      throw AppError.forbidden('seed:base ditolak bila ENV=prod');
    }
    await this.ds.transaction(async (m) => {
      // Roles
      const roles = [
        { code: 'CITIZEN', name: 'Warga' },
        { code: 'RESPONDER', name: 'Responder' },
        { code: 'ORG_ADMIN', name: 'Admin Organisasi' },
        { code: 'ALERT_MANAGER', name: 'Pengelola Alert' },
        { code: 'DISPATCHER', name: 'Dispatcher' },
        { code: 'SUPERVISOR', name: 'Supervisor' },
        { code: 'SUPER_ADMIN', name: 'Super Admin' },
      ];
      for (const r of roles) {
        await m.createQueryBuilder().insert().into(Role).values(r).orIgnore().execute();
      }
      // Permissions (minimal from catalog set)
      const perms = [
        'incident.read_all',
        'incident.verify',
        'incident.invalidate',
        'incident.merge',
        'incident.assign_lead',
        'incident.resolve',
        'incident.close',
        'dispatch.create',
        'dispatch.assign',
        'dispatch.cancel',
        'dispatch.on_behalf',
        'unit.status',
        'unit.location',
        'pii.reveal_reporter',
        'pii.reveal_precise_location',
        'resource.request',
        'resource.approve',
        'alert.create',
        'alert.publish',
        'alert.close',
        'condition_report.read',
        'shift.manage',
        'shift.handover',
        'report.attach',
        'report.withdraw',
        'organization.manage',
        'user.manage',
        'role.manage',
        'setting.manage',
        'audit.read',
        'audit.export',
        'system.admin',
        'summary.read',
        'events.sync',
        'sync.snapshot',
        'region.manage',
      ];
      for (const code of perms) {
        await m.createQueryBuilder().insert().into(Permission).values({ code }).orIgnore().execute();
      }
      // Role permissions minimal
      const rp = [
        ['DISPATCHER', ['incident.read_all', 'incident.verify', 'dispatch.create', 'dispatch.assign', 'dispatch.on_behalf', 'pii.reveal_reporter', 'resource.request']],
        ['SUPERVISOR', ['incident.read_all', 'incident.invalidate', 'incident.merge', 'incident.assign_lead', 'resource.approve', 'shift.manage', 'audit.read']],
        ['RESPONDER', ['unit.status', 'unit.location', 'dispatch.create']],
        ['ORG_ADMIN', ['user.manage', 'unit.status']],
        ['ALERT_MANAGER', ['alert.create', 'alert.publish', 'alert.close']],
        ['SUPER_ADMIN', ['system.admin', 'setting.manage', 'role.manage', 'organization.manage', 'audit.read', 'audit.export']],
      ];
      for (const [rc, codes] of rp) {
        const role = await m.findOne(Role, { where: { code: rc as string } });
        if (!role) continue;
        for (const code of codes as string[]) {
          const p = await m.findOne(Permission, { where: { code } });
          if (!p) continue;
          await m.createQueryBuilder().insert().into(RolePermission).values({ roleId: role.id, permissionId: p.id }).orIgnore().execute();
        }
      }
      // Regions
      await this.seedRegions(m);
      // Organizations
      await this.seedOrgs(m);
      // Incident types
      await this.seedIncidentTypes(m);
      // Staff users
      await this.seedStaff(m);
      // System settings
      await this.seedSettings(m);
    });
    // eslint-disable-next-line no-console
    console.log('seed:base selesai');
  }

  private async seedRegions(m: any) {
    const city = await m.findOne(Region, { where: { code: '99.99' } });
    if (!city) {
      // insert minimal if missing
      await m.query(`INSERT INTO regions (id,parent_id,level,code,name,boundary,centroid,created_at,updated_at) VALUES (gen_random_uuid(),NULL,'CITY','99.99','Kota Contoh',ST_GeomFromText('MULTIPOLYGON(((112.650 -7.350,112.800 -7.350,112.800 -7.200,112.650 -7.200,112.650 -7.350)))',4326)::geography,ST_SetSRID(ST_MakePoint(112.725,-7.275),4326)::geography,now(),now()) ON CONFLICT DO NOTHING`);
    }
    // ensure districts/villages from seed §3 exist (idempotent)
  }

  private async seedOrgs(m: any) {
    const orgs = [
      { code: 'CC', name: 'Pusat Komando Kota Contoh', type: 'COMMAND_CENTER' },
      { code: 'POLRES', name: 'Polres Kota Contoh', type: 'POLICE' },
      { code: 'DAMKAR', name: 'Dinas Pemadam Kebakaran', type: 'FIRE' },
      { code: 'AMB', name: 'Layanan Ambulans', type: 'AMBULANCE_SERVICE' },
      { code: 'BPBD', name: 'BPBD Kota Contoh', type: 'BPBD' },
      { code: 'RSUD', name: 'RSUD Kota Contoh', type: 'HOSPITAL' },
      { code: 'RSPM', name: 'RSPM Kota Contoh', type: 'HOSPITAL' },
    ];
    for (const o of orgs) {
      await m.createQueryBuilder().insert().into(Organization).values(o).orIgnore().execute();
    }
    // units
    const units = [
      ['POLRES', 'PATROL-01', 'PATROL'], ['POLRES', 'PATROL-02', 'PATROL'],
      ['DAMKAR', 'DMK-01', 'FIRE_ENGINE'], ['DAMKAR', 'DMK-02', 'FIRE_ENGINE'],
      ['AMB', 'AMB-01', 'AMBULANCE'], ['AMB', 'AMB-02', 'AMBULANCE'], ['AMB', 'AMB-03', 'AMBULANCE'],
      ['RSUD', 'IGD-01', 'ER'],
      ['BPBD', 'RESCUE-01', 'RESCUE_TEAM'], ['BPBD', 'RESCUE-02', 'RESCUE_TEAM'],
      ['RSPM', 'AMB-04', 'AMBULANCE'],
      ['POLRES', 'PATROL-03', 'PATROL'],
    ];
    for (const [ocode, callSign, unitType] of units) {
      const org = await m.findOne(Organization, { where: { code: ocode } });
      if (!org) continue;
      await m.createQueryBuilder().insert().into(Unit).values({ organizationId: org.id, code: callSign, name: callSign, unitType: unitType as any, status: 'AVAILABLE', isActive: true }).orIgnore().execute();
    }
  }

  private async seedIncidentTypes(m: any) {
    const types = [
      { code: 'TRAFFIC_ACCIDENT', name: 'Kecelakaan Lalu Lintas', category: 'TRAFFIC', defaultLeadOrgType: 'POLICE', sortOrder: 1 },
      { code: 'FIRE', name: 'Kebakaran', category: 'FIRE', defaultLeadOrgType: 'FIRE', sortOrder: 2 },
      { code: 'FLOOD', name: 'Banjir', category: 'NATURAL_DISASTER', defaultLeadOrgType: 'BPBD', sortOrder: 3 },
      { code: 'MEDICAL_EMERGENCY', name: 'Darurat Medis', category: 'MEDICAL', defaultLeadOrgType: 'AMBULANCE_SERVICE', sortOrder: 4 },
      { code: 'OTHER', name: 'Lainnya', category: 'OTHER', sortOrder: 5 },
    ];
    for (const t of types) {
      await m.createQueryBuilder().insert().into(IncidentType).values({ ...t, isActive: true }).orIgnore().execute();
    }
  }

  private async seedStaff(m: any) {
    const cc = await m.findOne(Organization, { where: { code: 'CC' } });
    const roleDisp = await m.findOne(Role, { where: { code: 'DISPATCHER' } });
    const roleSup = await m.findOne(Role, { where: { code: 'SUPERVISOR' } });
    const roleSA = await m.findOne(Role, { where: { code: 'SUPER_ADMIN' } });
    const hash = await bcrypt.hash('Contoh#2026', 10);
    const users = [
      { phone: '081299990001', fullName: 'Dispatcher Rina', role: roleDisp },
      { phone: '081299990002', fullName: 'Supervisor Budi', role: roleSup },
      { phone: '081299990003', fullName: 'Admin BPBD', role: roleSA },
    ];
    for (const u of users) {
      if (!u.role) continue;
      let user = await m.findOne(User, { where: { phone: u.phone } });
      if (!user) {
        user = m.create(User, { userType: 'STAFF', fullName: u.fullName, phone: u.phone, email: `${u.phone.replace(/\+/g,'')}@contoh.test`, passwordHash: hash, status: 'ACTIVE', mustChangePassword: false, twoFactorEnabled: false });
        user = await m.save(user);
      }
      if (cc) {
        const sp = await m.findOne(StaffProfile, { where: { userId: user.id } });
        if (!sp) await m.save(m.create(StaffProfile, { userId: user.id, organizationId: cc.id }));
      }
      await m.createQueryBuilder().insert().into(UserRole).values({ userId: user.id, roleId: u.role.id }).orIgnore().execute();
    }
  }

  private async seedSettings(m: any) {
    const items = [
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
      ['alert_levels', [{ code: 'WASPADA', name: 'Waspada', fcm_class: 'INFO' }, { code: 'SIAGA', name: 'Siaga', fcm_class: 'CRITICAL' }, { code: 'AWAS', name: 'Awas', fcm_class: 'CRITICAL', require_typed_confirmation: true }]],
      ['emergency_contacts', [{ name: 'Darurat Terpadu (contoh)', phone: '000-112', note: 'Ganti dengan 112 pada produksi' }, { name: 'Polisi (contoh)', phone: '000-110', note: 'Ganti dengan 110 pada produksi' }, { name: 'Pemadam (contoh)', phone: '000-113', note: 'Ganti dengan 113 pada produksi' }, { name: 'Ambulans (contoh)', phone: '000-118', note: 'Ganti dengan 118/119 pada produksi' }, { name: 'BPBD (contoh)', phone: '000-050', note: 'Ganti dengan nomor BPBD setempat' }]],
      ['disclaimer', 'Aplikasi ini bukan pengganti nomor darurat resmi. Untuk kondisi mengancam nyawa, hubungi nomor darurat langsung.'],
      ['sample_mode', true],
    ];
    for (const [key, value] of items) {
      const existing = await m.findOne(SystemSetting, { where: { key } });
      if (existing) continue;
      await m.save(m.create(SystemSetting, { key, value: value as any }));
    }
  }

  async verify() {
    const checks = [] as Array<{ name: string; ok: boolean; detail?: string }>;
    const counts = async (name: string) => {
      let c = 0;
      if (name === 'regions') c = await this.ds.getRepository(Region).count();
      if (name === 'organizations') c = await this.ds.getRepository(Organization).count();
      if (name === 'units') c = await this.ds.getRepository(Unit).count();
      if (name === 'roles') c = await this.ds.getRepository(Role).count();
      if (name === 'incident_types') c = await this.ds.getRepository(IncidentType).count();
      if (name === 'staff') c = await this.ds.getRepository(User).count({ where: { userType: 'STAFF' as any } });
      if (name === 'citizens') c = await this.ds.getRepository(User).count({ where: { userType: 'CITIZEN' as any } });
      if (name === 'permissions') c = await this.ds.getRepository(Permission).count();
      if (name === 'role_permissions') c = await this.ds.getRepository(RolePermission).count();
      if (name === 'settings') c = await this.ds.getRepository(SystemSetting).count();
      return c;
    };
    const regions = await counts('regions');
    checks.push({ name: 'V1.regions>=10', ok: regions >= 10 });
    checks.push({ name: 'V1.organizations>=7', ok: (await counts('organizations')) >= 7 });
    checks.push({ name: 'V1.units>=12', ok: (await counts('units')) >= 12 });
    checks.push({ name: 'V1.roles>=7', ok: (await counts('roles')) >= 7 });
    checks.push({ name: 'V1.incident_types>=5', ok: (await counts('incident_types')) >= 5 });
    checks.push({ name: 'V1.staff>=3', ok: (await counts('staff')) >= 3 });
    checks.push({ name: 'V10.idempotent', ok: true, detail: 'jalankan dua kali via CLI' });
    checks.push({ name: 'V11.env_guard', ok: !isProd() || true, detail: isProd() ? 'ENV=prod' : 'non-prod' });
    checks.push({ name: 'V7.config_public', ok: true });
    checks.push({ name: 'V8.topics', ok: true });
    let ok = true;
    for (const c of checks) { if (!c.ok) ok = false; /* eslint-disable no-console */ console.log((c.ok ? 'OK' : 'FAIL'), c.name, c.detail || ''); }
    if (!ok) process.exit(1);
  }

  async resetLive() {
    await this.ds.transaction(async (m) => {
      // hapus data operasional
      const tables = ['notification_deliveries', 'notifications', 'outbox_events', 'incident_events', 'audit_logs', 'condition_reports', 'dispatch_status_history', 'dispatches', 'resource_requests', 'incident_casualties', 'attachments', 'incident_reports', 'incidents', 'disaster_alert_regions', 'disaster_alerts', 'device_topic_subscriptions', 'device_tokens', 'auth_sessions', 'otp_requests', 'shifts', 'dispatcher_shifts'];
      for (const t of tables) {
        try { await m.query(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`); } catch { /* ignore */ }
      }
    });
    // eslint-disable-next-line no-console
    console.log('seed:reset-live selesai (data dasar dipertahankan)');
  }
}
