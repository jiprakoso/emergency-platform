import { SetMetadata } from '@nestjs/common';
import { PermissionCode } from './permissions.catalog';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Wajib memiliki salah satu permission (semantik OR). Penegakan relasi
 * (lead/own/related) tetap di policy layer service, bukan di guard ini.
 */
export const RequirePermission = (...codes: PermissionCode[] | string[]) =>
  SetMetadata(PERMISSIONS_KEY, codes);
