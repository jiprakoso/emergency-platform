import { PermissionService } from './permission.service';
import { RolePermission } from '../../database/entities/role-permission.entity';
import { UserRole } from '../../database/entities/user-role.entity';
import { ROLE_PERMISSIONS } from './permissions.catalog';
import { FakeRedis, FakeRepository, asRedis, asRepository } from '../../testing/fakes';

type RoleSeed = { roleId: string; codes: string[] };

/** Benih matriks role → izin untuk fake `role_permissions`. */
function seedRoles(): RoleSeed[] {
  return [
    { roleId: 'role-dispatcher', codes: ROLE_PERMISSIONS.DISPATCHER },
    { roleId: 'role-supervisor', codes: ROLE_PERMISSIONS.SUPERVISOR },
  ];
}

function buildService(rows: { userRoles: UserRole[]; redis: FakeRedis }) {
  const roles = seedRoles();
  const rolePermissions = new FakeRepository<RolePermission>({
    rawResolver: (params) => {
      const roleIds = (params.roleIds ?? []) as string[];
      const codes = roleIds.flatMap((roleId) => {
        const found = roles.find((r) => r.roleId === roleId);
        return found?.codes ?? [];
      });
      // DISTINCT seperti kueri asli.
      return [...new Set(codes)].map((code) => ({ code }));
    },
  });
  const userRoles = new FakeRepository<UserRole>({ rows: rows.userRoles });
  const service = new PermissionService(
    asRedis(rows.redis),
    asRepository(userRoles),
    asRepository(rolePermissions),
  );
  return { service, rolePermissions };
}

const USER_ID = 'user-dispatcher-1';

function userRoles(...roleIds: string[]): UserRole[] {
  return roleIds.map((roleId) => ({
    userId: USER_ID,
    roleId,
    role: { id: roleId, code: roleId === 'role-supervisor' ? 'SUPERVISOR' : 'DISPATCHER' },
  })) as UserRole[];
}

describe('PermissionService', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
  });

  it('mengambil daftar role pengguna', async () => {
    const { service } = buildService({ userRoles: userRoles('role-dispatcher'), redis });
    await expect(service.getRoles(USER_ID)).resolves.toEqual(['DISPATCHER']);
  });

  it('mengembalikan role kosong bila pengguna tanpa role', async () => {
    const { service } = buildService({ userRoles: [], redis });
    await expect(service.getRoles(USER_ID)).resolves.toEqual([]);
    await expect(service.getAccess(USER_ID)).resolves.toEqual({
      roles: [],
      permissions: new Set(),
    });
  });

  it('menggabungkan izin lintas role pada cache miss lalu menyimpan ke Redis', async () => {
    const rows = userRoles('role-dispatcher', 'role-supervisor');
    const { service } = buildService({ userRoles: rows, redis });

    const access = await service.getAccess(USER_ID);

    expect(access.roles).toEqual(['DISPATCHER', 'SUPERVISOR']);
    // Gabungan matriks = DISPATCHER ∪ SUPERVISOR (SUPERVISOR memuat DISPATCHER).
    expect(access.permissions).toEqual(new Set(ROLE_PERMISSIONS.SUPERVISOR));
    expect(access.permissions.has('incident.lock_override')).toBe(true);
    expect(access.permissions.has('incident.read_all')).toBe(true);

    const cached = await redis.get(`perm:user:${USER_ID}`);
    expect(cached).not.toBeNull();
    const parsed = JSON.parse(cached as string) as { roles: string[]; permissions: string[] };
    expect(parsed.roles).toEqual(['DISPATCHER', 'SUPERVISOR']);
    expect([...parsed.permissions].sort()).toEqual([...ROLE_PERMISSIONS.SUPERVISOR].sort());
  });

  it('memakai cache Redis tanpa menyentuh basis data bila masih berlaku', async () => {
    const rows = userRoles('role-dispatcher');
    const { service, rolePermissions } = buildService({ userRoles: rows, redis });
    await service.getAccess(USER_ID);

    const spy = jest.spyOn(rolePermissions, 'createQueryBuilder');
    spy.mockImplementation(() => {
      throw new Error('basis data tidak boleh dipanggil saat cache hidup');
    });

    const cached = await service.getAccess(USER_ID);
    expect(cached.roles).toEqual(['DISPATCHER']);
    expect(spy).not.toHaveBeenCalled();
  });

  it('menjawab hasPermission/hasAnyPermission dari matriks', async () => {
    const { service } = buildService({ userRoles: userRoles('role-dispatcher'), redis });

    await expect(service.hasPermission(USER_ID, 'dispatch.create')).resolves.toBe(true);
    await expect(service.hasPermission(USER_ID, 'settings.manage')).resolves.toBe(false);
    await expect(
      service.hasAnyPermission(USER_ID, ['settings.manage', 'incident.verify']),
    ).resolves.toBe(true);
    await expect(
      service.hasAnyPermission(USER_ID, ['settings.manage', 'role.manage']),
    ).resolves.toBe(false);
  });

  it('invalidate menghapus cache agar perubahan hak berlaku segera', async () => {
    const { service } = buildService({ userRoles: userRoles('role-dispatcher'), redis });
    await service.getAccess(USER_ID);
    expect(redis.keys()).toContain(`perm:user:${USER_ID}`);

    await service.invalidate(USER_ID);
    expect(redis.keys()).not.toContain(`perm:user:${USER_ID}`);
  });
});
