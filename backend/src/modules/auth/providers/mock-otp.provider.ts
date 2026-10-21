import { Injectable } from '@nestjs/common';
import { OtpDispatch, OtpProvider, OtpPurpose } from './otp-provider';

/** Kode OTP tetap untuk demo (seed §6): `123456`. Tidak boleh dipakai di produksi. */
export const MOCK_OTP_CODE = '123456';

@Injectable()
export class MockOtpProvider implements OtpProvider {
  readonly name = 'mock';

  async generate(_purpose: OtpPurpose): Promise<OtpDispatch> {
    return { code: MOCK_OTP_CODE };
  }
}
