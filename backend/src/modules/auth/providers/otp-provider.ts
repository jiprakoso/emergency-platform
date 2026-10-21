export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

export type OtpPurpose = 'REGISTER' | 'LOGIN' | 'RESET';

export type OtpDispatch = {
  /** Kode yang dibuat (mock mengembalikan kode tetap; penyedia nyata tidak). */
  code: string;
};

/**
 * Abstraksi pengiriman OTP. Penyedia sampel = `mock` (kode tetap `123456`).
 * Penyedia nyata (SMS/WhatsApp) menyusul; kontrak REST tidak berubah.
 */
export interface OtpProvider {
  readonly name: string;
  generate(purpose: OtpPurpose): Promise<OtpDispatch>;
}
