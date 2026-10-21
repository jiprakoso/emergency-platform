import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verifySync } from 'otplib';

const ISSUER = 'Emergency Platform (Sample)';

/**
 * TOTP untuk 2FA staf (REST §2). Rahasia disimpan pada `users.two_factor_secret`.
 */
@Injectable()
export class TotpService {
  generateSecret(): string {
    return generateSecret();
  }

  keyUri(accountName: string, secret: string): string {
    return generateURI({ secret, label: accountName, issuer: ISSUER });
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
