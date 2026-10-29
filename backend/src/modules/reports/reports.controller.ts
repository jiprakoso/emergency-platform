import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CreateReportDto, FollowUpDto, WithdrawDto } from './dto/reports.dto';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { envelope } from '../../common/envelope';
import { PageQueryDto } from '../../common/pagination/page-query.dto';

@Controller()
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Post('reports')
  async create(@CurrentUser() principal: AuthPrincipal, @Body() body: CreateReportDto, @Res({ passthrough: true }) res: any) {
    const result: any = await this.svc.createReport(principal, body);
    if (result && result._status) {
      res.status(result._status);
      const { _status, ...rest } = result;
      return envelope(rest.data ?? rest);
    }
    res.status(201);
    return envelope(result?.data ?? result);
  }

  @Get('reports/mine')
  async mine(@CurrentUser() principal: AuthPrincipal, @Query() q: PageQueryDto) {
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
