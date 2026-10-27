import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IncidentType, Region, SystemSetting } from '../../database/entities';
import { ClockService } from '../../common/clock/clock.service';
import { AppError } from '../../common/errors/app-error';
import { decodeCursor, encodeCursor, normalizeLimit } from '../../common/pagination/cursor';
import { RegionLookupService } from '../me/region-lookup.service';

type EmergencyContact = { name: string; phone: string; note?: string };

type OperatingHours = {
  timezone?: string;
  mode?: string;
  open?: string;
  close?: string;
};

type PublicRegion = {
  id: string;
  parentId: string | null;
  level: string;
  code: string;
  name: string;
};

/**
 * Nilai bawaan = data sampel seed §8: **nomor darurat contoh** (`000-112`, dst.),
 * bukan nomor asli (AGENTS aturan 11, skenario V7).
 */
const DEFAULT_EMERGENCY_CONTACTS: EmergencyContact[] = [
  { name: 'Darurat Terpadu (contoh)', phone: '000-112', note: 'Ganti dengan 112 pada produksi' },
  { name: 'Polisi (contoh)', phone: '000-110', note: 'Ganti dengan 110 pada produksi' },
  { name: 'Pemadam (contoh)', phone: '000-113', note: 'Ganti dengan 113 pada produksi' },
  { name: 'Ambulans (contoh)', phone: '000-118', note: 'Ganti dengan 118/119 pada produksi' },
  { name: 'BPBD (contoh)', phone: '000-050', note: 'Ganti dengan nomor BPBD setempat' },
];
const DEFAULT_OPERATING_HOURS: OperatingHours = { timezone: 'Asia/Jakarta', mode: '24x7' };
const DEFAULT_LIMITS = { photo_max_mb: 10, video_max_mb: 50, max_attachments: 5 };
const DEFAULT_MIN_APP_VERSION = '1.0.0';
const DEFAULT_DISCLAIMER =
  'Aplikasi ini bukan pengganti nomor darurat resmi. Untuk kondisi mengancam nyawa, hubungi nomor darurat langsung.';

@Injectable()
export class ReferenceService {
  constructor(
    @InjectRepository(IncidentType) private readonly incidentTypes: Repository<IncidentType>,
    @InjectRepository(Region) private readonly regions: Repository<Region>,
    @InjectRepository(SystemSetting) private readonly settings: Repository<SystemSetting>,
    private readonly clock: ClockService,
    private readonly regionLookup: RegionLookupService,
  ) {}

  /**
   * Konfigurasi publik (REST §5.2). Kunci `system_settings` mengikuti seed §8
   * (`min_app_version`, `operating_hours`, `emergency_contacts`, `limits`,
   * `disclaimer`, `sample_mode`).
   */
  async getPublicConfig() {
    const rows = await this.settings.find({ where: {} });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const operatingHours =
      (map.get('operating_hours') as OperatingHours | undefined) ?? DEFAULT_OPERATING_HOURS;

    return {
      serverTime: this.clock.now().toISOString(),
      minAppVersion: (map.get('min_app_version') as string | undefined) ?? DEFAULT_MIN_APP_VERSION,
      operatingHours,
      operatingNow: this.computeOperatingNow(operatingHours),
      emergencyContacts:
        (map.get('emergency_contacts') as EmergencyContact[] | undefined) ??
        DEFAULT_EMERGENCY_CONTACTS,
      limits: (map.get('limits') as Record<string, unknown> | undefined) ?? DEFAULT_LIMITS,
      disclaimer: (map.get('disclaimer') as string | undefined) ?? DEFAULT_DISCLAIMER,
      // Lencana MODE SAMPEL (seed §8 `sample_mode`); default true pada aplikasi sampel.
      sampleMode: map.get('sample_mode') !== false,
    };
  }

  private computeOperatingNow(hours: OperatingHours): boolean {
    if (hours.mode === '24x7') return true;
    const open = hours.open;
    const close = hours.close;
    if (!open || !close) return true;

    const tz = hours.timezone || 'Asia/Jakarta';
    let hour = 0;
    let minute = 0;
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(this.clock.now());
      hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
      minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    } catch {
      return true;
    }

    const [oh, om] = open.split(':').map((x) => Number(x));
    const [ch, cm] = close.split(':').map((x) => Number(x));
    const from = (Number.isNaN(oh) ? 0 : oh) * 60 + (Number.isNaN(om) ? 0 : om);
    const to = (Number.isNaN(ch) ? 23 : ch) * 60 + (Number.isNaN(cm) ? 59 : cm);
    const current = hour * 60 + minute;
    return from <= to ? current >= from && current <= to : current >= from || current <= to;
  }

  async getIncidentTypes() {
    return this.incidentTypes.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  /** Daftar wilayah tanpa `boundary`/`centroid` (REST §5.2: "tanpa polygon"). */
  async getRegions(opts: { level?: string; parentId?: string; limit?: number; cursor?: string }) {
    const limit = normalizeLimit(opts.limit);
    const qb = this.regions
      .createQueryBuilder('r')
      .orderBy('r.code', 'ASC')
      .take(limit + 1);
    if (opts.level) qb.andWhere('r.level = :level', { level: opts.level });
    if (opts.parentId) qb.andWhere('r.parent_id = :parentId', { parentId: opts.parentId });
    if (opts.cursor) {
      const payload = decodeCursor(opts.cursor);
      const after = typeof payload.c === 'string' ? payload.c : null;
      if (after === null) throw AppError.validation('Cursor tidak valid.');
      qb.andWhere('r.code > :after', { after });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const data: PublicRegion[] = page.map((r) => ({
      id: r.id,
      parentId: r.parentId,
      level: r.level,
      code: r.code,
      name: r.name,
    }));
    return {
      data,
      page: {
        nextCursor: hasMore ? encodeCursor({ c: data[data.length - 1].code }) : null,
        hasMore,
        limit,
      },
    };
  }

  /** Kecamatan/kelurahan dari titik (REST §5.2 `GET /regions/resolve`). */
  async resolvePoint(lng: number, lat: number) {
    const resolved = await this.regionLookup.resolve(lng, lat);
    return {
      inServiceArea: resolved.inServiceArea,
      district: resolved.district
        ? { code: resolved.district.code, name: resolved.district.name }
        : null,
      village: resolved.village
        ? { code: resolved.village.code, name: resolved.village.name }
        : null,
    };
  }
}
