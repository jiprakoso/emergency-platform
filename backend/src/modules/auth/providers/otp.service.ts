import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { OtpRequest } from '../../../database/entities/otp-request.entity';
import { sha256Hex } from '../../../common/crypto/hash';
import { ClockService } from '../../../common/clock/clock.service';
import { AppError } from '../../../common/errors/app-error';
import { OTP_MAX_ATTEMPTS } from '../../../common/rate-limit/rate-limit.rules';
import { OTP_PROVIDER, OtpProvider, OtpPurpose } from './otp-provider';

export type OtpRequestResult = {
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

@Injectable()
export class OtpService {
  constructor(
    @Inject(OTP_PROVIDER) private readonly provider: OtpProvider,
    @InjectRepository(OtpRequest) private readonly otpRepo: Repository<OtpRequest>,
    private readonly config: ConfigService,
    private readonly clock: ClockService,
  ) {}

  private get ttlSeconds(): number {
    return Number(this.config.get('OTP_TTL_SECONDS', 300));
  }

  async request(phone: string, purpose: OtpPurpose): Promise<OtpRequestResult> {
    const { code } = await this.provider.generate(purpose);
    const now = this.clock.now();
    const row = this.otpRepo.create({
      phone,
      codeHash: sha256Hex(`${phone}:${code}`),
      purpose,
      attempts: 0,
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
      verifiedAt: null,
      createdAt: now,
    });
    await this.otpRepo.save(row);
    return {
      expiresInSeconds: this.ttlSeconds,
      resendAfterSeconds: Number(this.config.get('OTP_RESEND_AFTER_SECONDS', 60)),
    };
  }

  /**
   * Verifikasi kode OTP terbaru untuk phone+purpose. Menandai terpakai bila sukses.
   * Gagal: `OTP_EXPIRED`, `OTP_INVALID`, atau `OTP_TOO_MANY_ATTEMPTS`.
   */
  async verify(phone: string, purpose: OtpPurpose, code: string): Promise<void> {
    const row = await this.otpRepo.findOne({
      where: { phone, purpose, verifiedAt: IsNull() },
      order: { createdAt: 'DESC' },
      select: {
        id: true,
        codeHash: true,
        attempts: true,
        expiresAt: true,
        verifiedAt: true,
      },
    });
    if (!row) {
      throw new AppError('OTP_INVALID', 'Kode OTP tidak valid.');
    }
    if (row.expiresAt.getTime() < this.clock.now().getTime()) {
      throw new AppError('OTP_EXPIRED', 'Kode OTP sudah kedaluwarsa.');
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      throw new AppError('OTP_TOO_MANY_ATTEMPTS', 'Terlalu banyak percobaan kode OTP.');
    }

    const match = row.codeHash === sha256Hex(`${phone}:${code}`);
    if (!match) {
      await this.otpRepo.increment({ id: row.id }, 'attempts', 1);
      throw new AppError('OTP_INVALID', 'Kode OTP tidak valid.');
    }

    await this.otpRepo.update({ id: row.id }, { verifiedAt: this.clock.now() });
  }
}
