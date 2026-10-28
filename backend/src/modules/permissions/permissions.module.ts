import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from '../../database/entities/permission.entity';
import { Role } from '../../database/entities/role.entity';
import { RolePermission } from '../../database/entities/role-permission.entity';
import { UserRole } from '../../database/entities/user-role.entity';
import { PermissionService } from './permission.service';
import { PermissionGuard } from './permission.guard';
import { AdminController } from './admin.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([UserRole, RolePermission, Role, Permission])],
  controllers: [AdminController],
  providers: [PermissionService, PermissionGuard],
  exports: [PermissionService, PermissionGuard],
})
export class PermissionsModule {}
