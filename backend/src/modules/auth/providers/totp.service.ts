import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { decryptSecret, encryptSecret, keyFrom } from '../../../common/crypto/secret-box';

const ISSUER = 'Emergency Platform (Sample)';

/**
 * TOTP untuk 2FA staf (REST §2). Rahasia disimpan pada `users.two_factor_secret`
 * dalam keadaan terenkripsi AES-256-GCM (handoff §9.5, kunci `TOTP_ENCRYPTION_KEY`).
 */
@Injectable()
export class TotpService {
  constructor(private readonly config: ConfigService) {}

  private get key(): Buffer {
    return keyFrom(this.config.get<string>('TOTP_ENCRYPTION_KEY'));
  }

  generateSecret(): string {
    return generateSecret();
  }

  keyUri(accountName: string, secret: string): string {
    return generateURI({ secret, label: accountName, issuer: ISSUER });
  }

  /** Bungkus rahasia untuk penyimpanan (kolom `two_factor_secret`). */
  seal(secret: string): string {
    return encryptSecret(secret, this.key);
  }

  /** Verifikasi kode terhadap nilai tersimpan (dilekripsi lebih dulu). */
  verifyStored(code: string, stored: string | null | undefined): boolean {
    if (!stored) return false;
    try {
      return this.verify(code, decryptSecret(stored, this.key));
    } catch {
      return false;
    }
  }

  verify(code: string, secret: string): boolean {
    try {
      const result = verifySync({ token: code, secret });
      return (result as { valid?: boolean }).valid === true;
    } catch {
      return false;
    }
  }
}
