import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { MeService } from './me.service';
import { DeviceService } from './device.service';
import { PatchMeDto } from './dto/me.dto';
import { DeviceInfoDto } from '../auth/dto/auth.dto';
import { envelope } from '../../common/envelope';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { AppError } from '../../common/errors/app-error';

@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly devices: DeviceService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Get()
  async get(@CurrentUser() principal: AuthPrincipal) {
    const data = await this.me.build(principal.userId, principal.userType === 'STAFF');
    return envelope(data);
  }

  @Patch()
  async patch(@CurrentUser() principal: AuthPrincipal, @Body() dto: PatchMeDto) {
    const data = await this.me.patch(principal.userId, dto);
    return envelope(data);
  }

  @Post('devices')
  @HttpCode(200)
  async registerDevice(@CurrentUser() principal: AuthPrincipal, @Body() dto: DeviceInfoDto) {
    const user = await this.users.findOne({ where: { id: principal.userId } });
    if (!user) throw AppError.notFound();
    const row = await this.devices.register(user, dto);
    if (!row) throw AppError.validation('Token FCM wajib diisi.', [{ field: 'fcmToken', issue: 'required' }]);
    return envelope({ id: row.id });
  }

  @Delete('devices/:id')
  @HttpCode(204)
  async revokeDevice(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<void> {
    await this.devices.revoke(principal.userId, id);
  }

  @Get('alert-topics')
  async alertTopics(@CurrentUser() principal: AuthPrincipal) {
    const user = await this.users.findOne({ where: { id: principal.userId } });
    if (!user) throw AppError.notFound();
    const topics = await this.devices.listActiveTopics(user);
    return envelope({ topics });
  }
}
