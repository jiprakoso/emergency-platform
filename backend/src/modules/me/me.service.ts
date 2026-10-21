import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { StaffProfile } from '../../database/entities/staff-profile.entity';
import { Organization } from '../../database/entities/organization.entity';
import { Unit } from '../../database/entities/unit.entity';
import { Region } from '../../database/entities/region.entity';
import { ClockService } from '../../common/clock/clock.service';
import { AppError } from '../../common/errors/app-error';
import { PermissionService } from '../permissions/permission.service';
import { RegionLookupService } from './region-lookup.service';
import { DeviceService } from './device.service';
import { PatchMeDto } from './dto/me.dto';

export type MeView = {
  id: string;
  userType: 'CITIZEN' | 'STAFF';
  fullName: string;
  phone: string;
  email: string | null;
  status: string;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  homeAddress: string | null;
  homeLocation: { lat: number; lng: number } | null;
  homeRegion: { code: string; name: string } | null;
  roles: string[];
  organization: { id: string; code: string | null; name: string; type: string } | null;
  unit: { id: string; code: string; name: string } | null;
  permissions?: string[];
};

@Injectable()
export class MeService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(StaffProfile) private readonly staffProfiles: Repository<StaffProfile>,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(Unit) private readonly units: Repository<Unit>,
    @InjectRepository(Region) private readonly regions: Repository<Region>,
    private readonly permissionService: PermissionService,
    private readonly regionLookup: RegionLookupService,
    private readonly devices: DeviceService,
    private readonly clock: ClockService,
  ) {}

  private parsePoint(value: unknown): { lat: number; lng: number } | null {
    if (!value) return null;
    try {
      const obj =
        typeof value === 'string'
          ? (JSON.parse(value) as { coordinates?: [number, number] })
          : (value as { coordinates?: [number, number] });
      if (!obj.coordinates) return null;
      const [lng, lat] = obj.coordinates;
      return { lat, lng };
    } catch {
      return null;
    }
  }

  async build(userId: string, includePermissions: boolean): Promise<MeView> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw AppError.notFound();

    const access = await this.permissionService.getAccess(userId);

    let organization: MeView['organization'] = null;
    let unit: MeView['unit'] = null;
    if (user.userType === 'STAFF') {
      const profile = await this.staffProfiles.findOne({ where: { userId } });
      if (profile) {
        const org = await this.organizations.findOne({ where: { id: profile.organizationId } });
        if (org) {
          organization = { id: org.id, code: org.code, name: org.name, type: org.type };
        }
        if (profile.unitId) {
          const u = await this.units.findOne({ where: { id: profile.unitId } });
          if (u) unit = { id: u.id, code: u.code, name: u.name };
        }
      }
    }

    let homeRegion: MeView['homeRegion'] = null;
    if (user.homeRegionId) {
      const region = await this.regions.findOne({ where: { id: user.homeRegionId } });
      if (region) homeRegion = { code: region.code, name: region.name };
    }

    const view: MeView = {
      id: user.id,
      userType: user.userType,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      twoFactorEnabled: user.twoFactorEnabled,
      homeAddress: user.homeAddress,
      homeLocation: this.parsePoint(user.homeLocation),
      homeRegion,
      roles: access.roles,
      organization,
      unit,
    };
    if (includePermissions) {
      view.permissions = [...access.permissions].sort();
    }
    return view;
  }

  async patch(userId: string, dto: PatchMeDto): Promise<MeView> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw AppError.notFound();
    const now = this.clock.now();
    const update: Partial<User> = { updatedAt: now };

    if (dto.fullName !== undefined) update.fullName = dto.fullName;
    if (dto.email !== undefined) update.email = dto.email;
    if (dto.homeAddress !== undefined) update.homeAddress = dto.homeAddress;

    if (dto.homeLocation !== undefined) {
      const resolved = await this.regionLookup.resolve(dto.homeLocation.lng, dto.homeLocation.lat);
      update.homeRegionId = resolved.village?.id ?? null;
    }

    await this.users.update({ id: userId }, update);
    if (dto.homeLocation !== undefined) {
      await this.users.query(
        `UPDATE users SET home_location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE id = $3`,
        [dto.homeLocation.lng, dto.homeLocation.lat, userId],
      );
    }

    // Perubahan lokasi rumah → langganan topik kecamatan disinkronkan ulang.
    if (dto.homeLocation !== undefined) {
      const fresh = await this.users.findOne({ where: { id: userId } });
      if (fresh) {
        const activeDevices = await this.devices.listActive(userId);
        for (const device of activeDevices) {
          await this.devices.syncTopics(fresh, device.id);
        }
      }
    }

    return this.build(userId, user.userType === 'STAFF');
  }
}
