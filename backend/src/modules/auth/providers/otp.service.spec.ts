import { OtpService } from './otp.service';
import { MOCK_OTP_CODE, MockOtpProvider } from './mock-otp.provider';
import { OtpRequest } from '../../../database/entities/otp-request.entity';
import { ClockService } from '../../../common/clock/clock.service';
import { OTP_MAX_ATTEMPTS } from '../../../common/rate-limit/rate-limit.rules';
import { sha256Hex } from '../../../common/crypto/hash';
import { AppError } from '../../../common/errors/app-error';
import { FakeRepository, asRepository, catchError, fakeConfig } from '../../../testing/fakes';

const PHONE = '0811-0000-0001';

function buildService() {
  const otpRepo = new FakeRepository<OtpRequest>();
  const service = new OtpService(
    new MockOtpProvider(),
    asRepository(otpRepo),
    fakeConfig({ OTP_TTL_SECONDS: 300, OTP_RESEND_AFTER_SECONDS: 60 }),
    new ClockService(),
  );
  return { service, otpRepo };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const err = await catchError(promise);
  expect(err).toBeInstanceOf(AppError);
  expect(err.code).toBe(code);
}

describe('OtpService', () => {
  it('menyimpan hash kode OTP, bukan kode plaintext', async () => {
    const { service, otpRepo } = buildService();

    const result = await service.request(PHONE, 'REGISTER');

    expect(result).toEqual({ expiresInSeconds: 300, resendAfterSeconds: 60 });
    expect(otpRepo.rows).toHaveLength(1);
    const row = otpRepo.rows[0];
    expect(row.codeHash).toBe(sha256Hex(`${PHONE}:${MOCK_OTP_CODE}`));
    expect(JSON.stringify(row)).not.toContain(MOCK_OTP_CODE);
    expect(row.attempts).toBe(0);
    expect(row.verifiedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('memverifikasi kode benar dan menandai terpakai', async () => {
    const { service, otpRepo } = buildService();
    await service.request(PHONE, 'REGISTER');

    await expect(service.verify(PHONE, 'REGISTER', MOCK_OTP_CODE)).resolves.toBeUndefined();

    expect(otpRepo.rows[0].verifiedAt).not.toBeNull();
    // Kode terpakai tidak bisa dipakai lagi (baris tidak lagi 'belum terverifikasi').
    await expectCode(service.verify(PHONE, 'REGISTER', MOCK_OTP_CODE), 'OTP_INVALID');
  });

  it('menolak kode salah dan menaikkan percobaan', async () => {
    const { service, otpRepo } = buildService();
    await service.request(PHONE, 'REGISTER');

    await expectCode(service.verify(PHONE, 'REGISTER', '999999'), 'OTP_INVALID');

    expect(otpRepo.rows[0].attempts).toBe(1);
    expect(otpRepo.rows[0].verifiedAt).toBeNull();
  });

  it('menolak saat belum ada permintaan OTP', async () => {
    const { service } = buildService();
    await expectCode(service.verify(PHONE, 'REGISTER', MOCK_OTP_CODE), 'OTP_INVALID');
  });

  it('menolak OTP yang berbeda tujuan (purpose)', async () => {
    const { service } = buildService();
    await service.request(PHONE, 'REGISTER');
    await expectCode(service.verify(PHONE, 'LOGIN', MOCK_OTP_CODE), 'OTP_INVALID');
    await expectCode(service.verify(PHONE, 'RESET', MOCK_OTP_CODE), 'OTP_INVALID');
  });

  it('menolak OTP kedaluwarsa', async () => {
    const { service, otpRepo } = buildService();
    await service.request(PHONE, 'REGISTER');
    otpRepo.rows[0].expiresAt = new Date(Date.now() - 1000);

    await expectCode(service.verify(PHONE, 'REGISTER', MOCK_OTP_CODE), 'OTP_EXPIRED');
  });

  it(`menolak setelah ${OTP_MAX_ATTEMPTS} percobaan gagal`, async () => {
    const { service, otpRepo } = buildService();
    await service.request(PHONE, 'REGISTER');
    otpRepo.rows[0].attempts = OTP_MAX_ATTEMPTS;

    await expectCode(service.verify(PHONE, 'REGISTER', MOCK_OTP_CODE), 'OTP_TOO_MANY_ATTEMPTS');
  });
});
