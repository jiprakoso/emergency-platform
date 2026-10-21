import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';

@Controller('health')
@Public()
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  ready() {
    return {
      status: 'ready',
      checks: {
        db: 'pending', // akan diperbarui saat koneksi DB siap
        redis: 'pending',
        storage: 'pending',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
