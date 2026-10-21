import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Region } from '../../database/entities/region.entity';

export type ResolvedRegion = {
  inServiceArea: boolean;
  district: Region | null;
  village: Region | null;
};

/**
 * Menentukan kecamatan/kelurahan dari titik memakai PostGIS mentah (D-001).
 * `geography(Point,4326)` → ST_Contains(boundary, point).
 */
@Injectable()
export class RegionLookupService {
  constructor(@InjectRepository(Region) private readonly regions: Repository<Region>) {}

  /** Kelurahan yang memuat titik (level VILLAGE), bila ada. */
  async findByPoint(lng: number, lat: number): Promise<Region | null> {
    const rows = await this.regions.query(
      `SELECT * FROM regions
       WHERE level = 'VILLAGE' AND boundary IS NOT NULL
         AND ST_Contains(boundary::geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
       LIMIT 1`,
      [lng, lat],
    );
    return rows.length > 0 ? (rows[0] as Region) : null;
  }

  async resolve(lng: number, lat: number): Promise<ResolvedRegion> {
    const village = await this.findByPoint(lng, lat);
    if (!village) {
      return { inServiceArea: false, district: null, village: null };
    }
    const district = village.parentId
      ? await this.regions.findOne({ where: { id: village.parentId } })
      : null;
    return { inServiceArea: true, district, village };
  }

  async getDistrictForVillage(villageId: string): Promise<Region | null> {
    const village = await this.regions.findOne({ where: { id: villageId } });
    if (!village) return null;
    if (village.level === 'DISTRICT') return village;
    if (!village.parentId) return null;
    return this.regions.findOne({ where: { id: village.parentId } });
  }
}
