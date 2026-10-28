import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from '../../database/entities/permission.entity';
import { Role } from '../../database/entities/role.entity';
import { envelope } from '../../common/envelope';
import { RequirePermission } from './permission.decorators';

/**
 * Endpoint baca admin (REST §5.12, tag `admin`): daftar role dan permission.
 * Keduanya dijaga `role.manage` (kontrak `GETRoles`/`GETPermissions`:
 * `x-permission: role.manage`, contoh `contracts/examples/rest/GETRoles.json`
 * dan `GETPermissions.json`).
 *
 * Isi diambil dari basis data — tabel yang sama dipakai penegakan akses —
 * bukan dari katalog statis.
 */
@Controller()
export class AdminController {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission) private readonly permissions: Repository<Permission>,
  ) {}

  @Get('roles')
  @RequirePermission('role.manage')
  async listRoles() {
    const rows = await this.roles.find({ order: { createdAt: 'ASC', code: 'ASC' } });
    return envelope(rows.map((row) => ({ code: row.code, name: row.name })));
  }

  @Get('permissions')
  @RequirePermission('role.manage')
  async listPermissions() {
    const rows = await this.permissions.find({ order: { code: 'ASC' } });
    return envelope(rows.map((row) => row.code));
  }
}
