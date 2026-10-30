import { maskAuditData } from './audit.service';

describe('maskAuditData (handoff §11 no. 2: tanpa PII di audit before/after)', () => {
  it('null/undefined tetap null', () => {
    expect(maskAuditData(null)).toBeNull();
    expect(maskAuditData(undefined)).toBeNull();
  });

  it('kunci PII, lokasi, dan teks bebas diredaksi; id dan status dipertahankan', () => {
    const masked = maskAuditData({
      status: 'INVALID',
      leadOrganizationId: 'org-1',
      phone: '0812-0000-0001',
      reporterName: 'Budi',
      description: 'korban tidak sadar',
      reason: 'laporan palsu dari Budi',
      location: { lat: -7.27, lng: 112.7 },
    });
    expect(masked).toEqual({
      status: 'INVALID',
      leadOrganizationId: 'org-1',
      phone: '[REDACTED]',
      reporterName: '[REDACTED]',
      description: '[REDACTED]',
      reason: '[REDACTED]',
      location: '[REDACTED]',
    });
  });

  it('redaksi rekursif di objek dan larik bersarang, tanpa mengubah masukan', () => {
    const input = { items: [{ id: 'r1', phone: '0812' }], meta: { fullName: 'Sari', fields: ['name', 'phone'] } };
    const masked = maskAuditData(input);
    expect(masked).toEqual({
      items: [{ id: 'r1', phone: '[REDACTED]' }],
      meta: { fullName: '[REDACTED]', fields: ['name', 'phone'] },
    });
    expect(input.items[0].phone).toBe('0812');
  });
});
