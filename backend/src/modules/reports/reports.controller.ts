import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { CreateReportDto, FollowUpDto, WithdrawDto } from './dto/reports.dto';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { envelope } from '../../common/envelope';
import { RequirePermission } from '../permissions/permission.decorators';
import { AuditCtx } from '../audit/audit-context.decorator';
import type { AuditContext } from '../audit/audit.service';

@Controller()
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Post('reports')
  @RequirePermission('report.create')
  async create(@CurrentUser() principal: AuthPrincipal, @Body() body: CreateReportDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.svc.createReport(principal, body);
    res.status(result._status);
    return envelope(result.data);
  }

  @Get('reports/mine')
  @RequirePermission('report.read_own')
  async mine(@CurrentUser() principal: AuthPrincipal) {
    const res = await this.svc.mine(principal);
    return res; // page envelope
  }

  @Get('reports/:id')
  @RequirePermission('report.read_own')
  async getById(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal) {
    return envelope(await this.svc.getById(id, principal));
  }

  @Get('reports/:id/timeline')
  @RequirePermission('report.read_own')
  async timeline(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal) {
    const res = await this.svc.timeline(id, principal);
    return res;
  }

  @Post('reports/:id/follow-ups')
  @RequirePermission('report.create')
  async followUp(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body: FollowUpDto) {
    return envelope(await this.svc.followUp(id, principal, body));
  }

  @Post('reports/:id/withdraw')
  @RequirePermission('report.read_own')
  @HttpCode(200)
  async withdraw(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body: WithdrawDto) {
    return envelope(await this.svc.withdraw(id, principal, body));
  }

  @Post('reports/:id/reveal-contact')
  @RequirePermission('pii.reveal_reporter')
  @HttpCode(200)
  async revealContact(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @AuditCtx() ctx: AuditContext) {
    return envelope(await this.svc.revealContact(id, principal, ctx));
  }
}
