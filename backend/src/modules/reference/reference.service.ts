import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IncidentType, Region, SystemSetting } from '../../database/entities';
import { ClockService } from '../../common/clock/clock.service';
import { AppError } from '../../common/errors/app-error';

const DEFAULT_PUBLIC_CONFIG = {
  minAppVersion: '1.0.0',
  operatingHours: { open: '08:00', close: '20:00', timezone: 'Asia/Jakarta' },
  emergencyContacts: [
    { name: 'Ambulans/IGD (darurat)', phone: '118' },
    { name: 'Pemadam Kebakaran', phone: '113' },
    { name: 'Polisi', phone: '110' },
    { name: 'SAR', phone: '115' },
    { name: 'BPBD', phone: '115' },
  ],
  limits: { maxAttachmentSizeMb: 10, maxAttachmentsPerReport: 5 },
  disclaimer: 'Aplikasi sampel untuk demonstrasi. Nomor darurat sampel, bukan nomor resmi.',
};

@Injectable()
export class ReferenceService {
  constructor(
    @InjectRepository(IncidentType) private readonly incidentTypes: Repository<IncidentType>,
    @InjectRepository(Region) private readonly regions: Repository<Region>,
    @InjectRepository(SystemSetting) private readonly settings: Repository<SystemSetting>,
    private readonly clock: ClockService,
  ) {}

  async getPublicConfig() {
    const rows = await this.settings.find({ where: {} });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const config = {
      serverTime: this.clock.now().toISOString(),
      minAppVersion: (map.get('app.min_version') as string) || DEFAULT_PUBLIC_CONFIG.minAppVersion,
      operatingHours: (map.get('app.operating_hours') as any) || DEFAULT_PUBLIC_CONFIG.operatingHours,
      operatingNow: true,
      emergencyContacts: (map.get('app.emergency_contacts') as any) || DEFAULT_PUBLIC_CONFIG.emergencyContacts,
      limits: (map.get('app.limits') as any) || DEFAULT_PUBLIC_CONFIG.limits,
      disclaimer: (map.get('app.disclaimer') as string) || DEFAULT_PUBLIC_CONFIG.disclaimer,
    };
    // operatingNow sederhana (bisa diperluas nanti)
    const tz = config.operatingHours.timezone || 'Asia/Jakarta';
    try {
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(now);
      const h = Number(parts.find((p) => p.type === 'hour')?.value || '0');
      const m = Number(parts.find((p) => p.type === 'minute')?.value || '0');
      const open = String(config.operatingHours.open || '08:00');
      const close = String(config.operatingHours.close || '20:00');
      const [oh, om] = open.split(':').map((x) => Number(x));
      const [ch, cm] = close.split(':').map((x) => Number(x));
      const t = h * 60 + m;
      const to = (Number.isNaN(oh) ? 8 : oh) * 60 + (Number.isNaN(om) ? 0 : om);
      const tc = (Number.isNaN(ch) ? 20 : ch) * 60 + (Number.isNaN(cm) ? 0 : cm);
      if (to <= tc) config.operatingNow = t >= to && t <= tc;
      else config.operatingNow = t >= to || t <= tc;
    } catch {
      config.operatingNow = true;
    }
    return config;
  }

  async getIncidentTypes() {
    return this.incidentTypes.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async getRegions(opts: { level?: string; parentId?: string; limit?: number; cursor?: string }) {
    const limit = Math.min(opts.limit ?? 100, 200);
    let qb = this.regions.createQueryBuilder('r').orderBy('r.code', 'ASC').take(limit + 1);
    if (opts.level) qb = qb.andWhere('r.level = :level', { level: opts.level });
    if (opts.parentId) qb = qb.andWhere('r.parent_id = :parentId', { parentId: opts.parentId });
    if (opts.cursor) {
      // cursor sederhana by code
      qb = qb.andWhere('r.code > :cursor', { cursor: opts.cursor });
    }
    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return { data, page: { nextCursor: hasMore ? data[data.length - 1]?.code : null } };
  }

  async getRegionsById(id: string) {
    const r = await this.regions.findOne({ where: { id } });
    if (!r) throw AppError.notFound();
    return r;
  }
}
