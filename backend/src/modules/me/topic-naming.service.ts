import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Penamaan FCM topic (fcm §3.1). Awalan lingkungan wajib. Sampel memakai `dev`.
 * `{env}_city`, `{env}_kec_{kode}` (titik dibuang), `{env}_staff_alerts`, `{env}_test`.
 */
@Injectable()
export class TopicNamingService {
  constructor(private readonly config: ConfigService) {}

  private get env(): string {
    const raw =
      this.config.get<string>('FCM_TOPIC_ENV') ||
      (this.config.get<string>('NODE_ENV') === 'production' ? 'prod' : 'dev');
    return raw;
  }

  city(): string {
    return `${this.env}_city`;
  }

  district(districtCode: string): string {
    return `${this.env}_kec_${districtCode.replace(/\./g, '')}`;
  }

  staffAlerts(): string {
    return `${this.env}_staff_alerts`;
  }

  test(): string {
    return `${this.env}_test`;
  }
}
