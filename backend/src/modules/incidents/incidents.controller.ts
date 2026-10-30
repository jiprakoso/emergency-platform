import { Controller, Delete, Get, Post, Put, Patch, Query, Body, HttpCode } from '@nestjs/common';
import { IncidentsService } from './incidents.service';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { envelope } from '../../common/envelope';
import { RequirePermission } from '../permissions/permission.decorators';
import { AuditCtx } from '../audit/audit-context.decorator';
import type { AuditContext } from '../audit/audit.service';
import { IdParam } from '../../common/pipes/id-param';
import { PageQueryDto } from '../../common/pagination/page-query.dto';
import {
  CasualtyBody,
  EventsQueryDto,
  IncidentsQueryDto,
  NearbyQueryDto,
  CloseBody,
  InvalidateBody,
  LeadBody,
  LockBody,
  MergeBody,
  MilestoneBody,
  NoteBody,
  PatchBody,
  ResolveBody,
  VerifyBody,
} from './dto/incidents.dto';

@Controller()
export class IncidentsController {
  constructor(private readonly svc: IncidentsService) {}

  @Get('incidents')
  @RequirePermission('incident.read_all')
  async list(@Query() query: IncidentsQueryDto) {
    return this.svc.list(query);
  }

  @Get('incidents/:id')
  @RequirePermission('incident.read_all', 'incident.read_related')
  async getById(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal) {
    return envelope(await this.svc.getById(id, principal));
  }

  @Post('incidents/:id/lock')
  @RequirePermission('incident.lock')
  @HttpCode(200)
  async lock(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal, @AuditCtx() ctx: AuditContext, @Body() body?: LockBody) {
    return envelope(await this.svc.lock(id, principal, body, ctx));
  }

  @Delete('incidents/:id/lock')
  @RequirePermission('incident.lock')
  @HttpCode(204)
  async unlock(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal, @AuditCtx() ctx: AuditContext) {
    await this.svc.unlock(id, principal, ctx);
    return;
  }

  @Post('incidents/:id/lock/renew')
  @RequirePermission('incident.lock')
  @HttpCode(200)
  async renew(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal) {
    return envelope(await this.svc.renewLock(id, principal));
  }

  @Post('incidents/:id/verify')
  @RequirePermission('incident.verify')
  @HttpCode(200)
  async verify(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal, @Body() body: VerifyBody) {
    return envelope(await this.svc.verify(id, principal, body));
  }

  @Post('incidents/:id/invalidate')
  @RequirePermission('incident.invalidate')
  @HttpCode(200)
  async invalidate(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal, @AuditCtx() ctx: AuditContext, @Body() body: InvalidateBody) {
    return envelope(await this.svc.invalidate(id, principal, body, ctx));
  }

  @Post('incidents/:id/merge')
  @RequirePermission('incident.merge')
  @HttpCode(200)
  async merge(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal, @AuditCtx() ctx: AuditContext, @Body() body: MergeBody) {
    return envelope(await this.svc.merge(id, principal, body, ctx));
  }

  @Put('incidents/:id/lead')
  @RequirePermission('incident.set_lead')
  async lead(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal, @AuditCtx() ctx: AuditContext, @Body() body: LeadBody) {
    return envelope(await this.svc.setLead(id, principal, body, ctx));
  }

  @Post('incidents/:id/resolve')
  @RequirePermission('incident.close')
  @HttpCode(200)
  async resolve(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal, @Body() body: ResolveBody) {
    return envelope(await this.svc.resolve(id, principal, body));
  }

  @Post('incidents/:id/close')
  @RequirePermission('incident.close')
  @HttpCode(200)
  async close(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal, @Body() body: CloseBody) {
    return envelope(await this.svc.close(id, principal, body));
  }

  @Get('incidents/:id/nearby')
  @RequirePermission('incident.read_all')
  async nearby(@IdParam() id: string, @Query() query: NearbyQueryDto) {
    return this.svc.nearby(id, query.radiusM, query.hours);
  }

  @Patch('incidents/:id')
  @RequirePermission('incident.update')
  async patch(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal, @Body() body: PatchBody) {
    return envelope(await this.svc.patch(id, principal, body));
  }

  @Get('incidents/:id/events')
  @RequirePermission('incident.read_all', 'incident.read_related')
  async events(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal, @Query() query: EventsQueryDto) {
    return this.svc.getEvents(id, principal, query);
  }

  @Get('incidents/:id/reports')
  @RequirePermission('incident.read_all')
  async reports(@IdParam() id: string, @Query() query: PageQueryDto) {
    return this.svc.getReports(id, query);
  }

  @Post('incidents/:id/notes')
  @RequirePermission('note.create')
  async notes(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal, @Body() body: NoteBody) {
    return envelope(await this.svc.addNote(id, principal, body));
  }

  @Post('incidents/:id/casualties')
  @RequirePermission('casualty.update')
  async casualties(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal, @Body() body: CasualtyBody) {
    return envelope(await this.svc.addCasualty(id, principal, body));
  }

  @Post('incidents/:id/milestones')
  @RequirePermission('milestone.create')
  async milestones(@IdParam() id: string, @CurrentUser() principal: AuthPrincipal, @Body() body: MilestoneBody) {
    return envelope(await this.svc.addMilestone(id, principal, body));
  }

  @Get('incidents/:id/dispatch-recommendations')
  @RequirePermission('dispatch.create')
  async dispatchRecommendations(@IdParam() id: string) {
    return envelope(await this.svc.getDispatchRecommendations(id));
  }
}
