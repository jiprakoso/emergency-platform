/**
 * Batas laju awal sesuai REST §8. Angka adalah titik awal pilot (dapat disetel).
 */
export type RateLimitRule = {
  /** Nama cakupan untuk kunci Redis. */
  scope: string;
  limit: number;
  windowSeconds: number;
};

export const RateLimitRules: Record<string, RateLimitRule> = {
  otpRequestPerPhone: { scope: 'otp:phone', limit: 3, windowSeconds: 10 * 60 },
  otpRequestPerIp: { scope: 'otp:ip', limit: 10, windowSeconds: 60 * 60 },
  staffLoginPerAccount: { scope: 'stafflogin:account', limit: 5, windowSeconds: 15 * 60 },
  reportsHelpPerUser: { scope: 'reports:help:user', limit: 3, windowSeconds: 10 * 60 },
  reportsHelpPerUserDaily: { scope: 'reports:help:day:user', limit: 10, windowSeconds: 24 * 60 * 60 },
  reportsConditionPerUser: { scope: 'reports:cond:user', limit: 10, windowSeconds: 10 * 60 },
  attachmentUploadPerUser: { scope: 'attach:user', limit: 20, windowSeconds: 60 * 60 },
  staffGeneralPerUser: { scope: 'staff:general', limit: 300, windowSeconds: 60 },
  publicPerIp: { scope: 'public:ip', limit: 60, windowSeconds: 60 },
};

/** Verifikasi OTP: maksimum percobaan per OTP (REST §8). */
export const OTP_MAX_ATTEMPTS = 5;
