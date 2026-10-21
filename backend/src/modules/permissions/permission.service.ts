import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { Permission } from '../../database/entities/permission.entity';
import { RolePermission } from '../../database/entities/role-permission.entity';
import { UserRole } from '../../database/entities/user-role.entity';

const CACHE_TTL_SECONDS = 60;

export type UserAccess = {
  roles: string[];
  permissions: Set<string>;
};

/**
 * Menghitung role + permission pengguna dari basis data (REST §2: permission
 * TIDAK ditaruh di token, dihitung di server dengan cache singkat agar
 * perubahan hak akses langsung berlaku).
 */
@Injectable()
export class PermissionService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(RolePermission) private readonly rolePermissions: Repository<RolePermission>,
  ) {}

  async getRoles(userId: string): Promise<string[]> {
    const rows = await this.userRoles.find({ where: { userId }, relations: { role: true } });
    return rows.map((r) => r.role.code);
  }

  async getAccess(userId: string): Promise<UserAccess> {
    const cacheKey = `perm:user:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { roles: string[]; permissions: string[] };
      return { roles: parsed.roles, permissions: new Set(parsed.permissions) };
    }

    const roleRows = await this.userRoles.find({ where: { userId }, relations: { role: true } });
    const roles = roleRows.map((r) => r.role.code);

    let permissions: string[] = [];
    if (roleRows.length > 0) {
      const perms = await this.rolePermissions
        .createQueryBuilder('rp')
        .innerJoin(Permission, 'p', 'p.id = rp.permission_id')
        .where('rp.role_id IN (:...roleIds)', { roleIds: roleRows.map((r) => r.roleId) })
        .select('DISTINCT p.code', 'code')
        .getRawMany<{ code: string }>();
      permissions = perms.map((p) => p.code);
    }

    await this.redis.set(
      cacheKey,
      JSON.stringify({ roles, permissions }),
      'EX',
      CACHE_TTL_SECONDS,
    );
    return { roles, permissions: new Set(permissions) };
  }

  async hasPermission(userId: string, code: string): Promise<boolean> {
    const access = await this.getAccess(userId);
    return access.permissions.has(code);
  }

  async hasAnyPermission(userId: string, codes: string[]): Promise<boolean> {
    const access = await this.getAccess(userId);
    return codes.some((c) => access.permissions.has(c));
  }

  /** Panggil setelah mengubah role/permission agar cache tidak basi. */
  async invalidate(userId: string): Promise<void> {
    await this.redis.del(`perm:user:${userId}`);
  }
}
