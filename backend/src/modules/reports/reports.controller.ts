import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { CreateReportDto, FollowUpDto, WithdrawDto } from './dto/reports.dto';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { envelope } from '../../common/envelope';

@Controller()
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Post('reports')
  async create(@CurrentUser() principal: AuthPrincipal, @Body() body: CreateReportDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.svc.createReport(principal, body);
    res.status(result._status);
    return envelope(result.data);
  }

  @Get('reports/mine')
  async mine(@CurrentUser() principal: AuthPrincipal) {
    const res = await this.svc.mine(principal);
    return res; // page envelope
  }

  @Get('reports/:id')
  async getById(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal) {
    return envelope(await this.svc.getById(id, principal));
  }

  @Get('reports/:id/timeline')
  async timeline(@Param('id') id: string) {
    const res = await this.svc.timeline(id);
    return res;
  }

  @Post('reports/:id/follow-ups')
  async followUp(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body: FollowUpDto) {
    return envelope(await this.svc.followUp(id, principal, body));
  }

  @Post('reports/:id/withdraw')
  async withdraw(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body: WithdrawDto) {
    return envelope(await this.svc.withdraw(id, principal, body));
  }

  @Post('reports/:id/reveal-contact')
  async revealContact(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal) {
    return envelope(await this.svc.revealContact(id, principal));
  }
}
