import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';

/**
 * Kata sandi memakai Argon2id (handoff §9.5).
 *
 * Hash bcrypt (`$2*`) dari seed awal Fase 1 tetap diverifikasi agar akun demo
 * lama tidak terkunci; `isLegacy` menandainya untuk ditingkatkan ke Argon2
 * saat `seed:base` berikutnya dijalankan.
 */
@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(plain: string, hash: string | null | undefined): Promise<boolean> {
    if (!hash) return false;
    if (this.isLegacy(hash)) return bcrypt.compare(plain, hash);
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  isLegacy(hash: string | null | undefined): boolean {
    return typeof hash === 'string' && hash.startsWith('$2');
  }
}
