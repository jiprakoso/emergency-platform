import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { Public, CurrentUser } from './auth.decorators';
import { AuthPrincipal } from './auth.types';
import {
  CitizenLoginDto,
  CitizenRegisterDto,
  OtpRequestDto,
  PasswordChangeDto,
  RefreshDto,
  StaffLogin2faDto,
  StaffLoginDto,
  TwoFactorEnableDto,
} from './dto/auth.dto';
import { OtpService } from './providers/otp.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { RateLimitRules } from '../../common/rate-limit/rate-limit.rules';
import { envelope } from '../../common/envelope';
import { SessionContext } from './providers/session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private ctx(req: Request): SessionContext {
    return {
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };
  }

  @Public()
  @Post('otp/request')
  @HttpCode(202)
  async otpRequest(@Body() dto: OtpRequestDto, @Req() req: Request) {
    await this.rateLimit.enforce(RateLimitRules.otpRequestPerPhone, dto.phone);
    if (req.ip) {
      await this.rateLimit.enforce(RateLimitRules.otpRequestPerIp, req.ip);
    }
    const result = await this.otp.request(dto.phone, dto.purpose);
    return result;
  }

  @Public()
  @Post('citizen/register')
  async citizenRegister(@Body() dto: CitizenRegisterDto, @Req() req: Request) {
    const data = await this.auth.citizenRegister(dto, this.ctx(req));
    return envelope(data);
  }

  @Public()
  @Post('citizen/login')
  @HttpCode(200)
  async citizenLogin(@Body() dto: CitizenLoginDto, @Req() req: Request) {
    const data = await this.auth.citizenLogin(dto, this.ctx(req));
    return envelope(data);
  }

  @Public()
  @Post('staff/login')
  @HttpCode(200)
  async staffLogin(@Body() dto: StaffLoginDto, @Req() req: Request) {
    await this.rateLimit.enforce(RateLimitRules.staffLoginPerAccount, dto.identifier);
    const data = await this.auth.staffLogin(dto, this.ctx(req));
    await this.rateLimit.reset(RateLimitRules.staffLoginPerAccount, dto.identifier);
    return envelope(data);
  }

  @Public()
  @Post('staff/login/2fa')
  @HttpCode(200)
  async staffLogin2fa(@Body() dto: StaffLogin2faDto, @Req() req: Request) {
    const data = await this.auth.staffLogin2fa(dto, this.ctx(req));
    return envelope(data);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto) {
    const data = await this.auth.refresh(dto.refreshToken);
    return envelope(data);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() principal: AuthPrincipal): Promise<void> {
    await this.auth.logout(principal);
  }

  @Get('sessions')
  async sessions(@CurrentUser() principal: AuthPrincipal) {
    const data = await this.auth.listSessions(principal.userId);
    return { data, page: { hasMore: false, limit: data.length, nextCursor: null } };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<void> {
    await this.auth.revokeSession(principal.userId, id);
  }

  @Post('password/change')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: PasswordChangeDto,
  ): Promise<void> {
    await this.auth.changePassword(principal.userId, dto.currentPassword, dto.newPassword);
  }

  @Post('2fa/setup')
  @HttpCode(200)
  async setupTwoFactor(@CurrentUser() principal: AuthPrincipal) {
    const data = await this.auth.setupTwoFactor(principal.userId);
    return envelope(data);
  }

  @Post('2fa/enable')
  @HttpCode(204)
  async enableTwoFactor(
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: TwoFactorEnableDto,
  ): Promise<void> {
    await this.auth.enableTwoFactor(principal.userId, dto.code);
  }
}
