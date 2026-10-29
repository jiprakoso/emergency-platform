import { Controller, Delete, Get, Param, Post, Put, Patch, Query, Body, HttpCode } from '@nestjs/common';
import { IncidentsService } from './incidents.service';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { envelope } from '../../common/envelope';
import { RequirePermission } from '../permissions/permission.decorators';
import type {
  CasualtyBody,
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
  async list() {
    return this.svc.list();
  }

  @Get('incidents/:id')
  async getById(@Param('id') id: string, @CurrentUser() principal?: AuthPrincipal) {
    return envelope(await this.svc.getById(id, principal));
  }

  @Post('incidents/:id/lock')
  @RequirePermission('incident.lock')
  async lock(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: LockBody) {
    return envelope(await this.svc.lock(id, principal, body));
  }

  @Delete('incidents/:id/lock')
  @RequirePermission('incident.lock')
  @HttpCode(204)
  async unlock(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal) {
    await this.svc.unlock(id, principal);
    return;
  }

  @Post('incidents/:id/lock/renew')
  @RequirePermission('incident.lock')
  async renew(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal) {
    return envelope(await this.svc.renewLock(id, principal));
  }

  @Post('incidents/:id/verify')
  @RequirePermission('incident.verify')
  async verify(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: VerifyBody) {
    return envelope(await this.svc.verify(id, principal, body));
  }

  @Post('incidents/:id/invalidate')
  @RequirePermission('incident.invalidate')
  async invalidate(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: InvalidateBody) {
    return envelope(await this.svc.invalidate(id, principal, body));
  }

  @Post('incidents/:id/merge')
  @RequirePermission('incident.merge')
  async merge(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: MergeBody) {
    return envelope(await this.svc.merge(id, principal, body));
  }

  @Put('incidents/:id/lead')
  @RequirePermission('incident.set_lead')
  async lead(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: LeadBody) {
    return envelope(await this.svc.setLead(id, principal, body));
  }

  @Post('incidents/:id/resolve')
  @RequirePermission('incident.close')
  async resolve(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: ResolveBody) {
    return envelope(await this.svc.resolve(id, principal, body));
  }

  @Post('incidents/:id/close')
  @RequirePermission('incident.close')
  async close(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: CloseBody) {
    return envelope(await this.svc.close(id, principal, body));
  }

  @Get('incidents/:id/nearby')
  async nearby(@Param('id') id: string, @Query('radiusM') radiusM?: string, @Query('hours') hours?: string) {
    const res = await this.svc.nearby(id, radiusM ? parseInt(radiusM) : 300, hours ? parseInt(hours) : 6);
    return envelope(res);
  }

  @Patch('incidents/:id')
  @RequirePermission('incident.update')
  async patch(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: PatchBody) {
    return envelope(await this.svc.patch(id, principal, body));
  }

  @Get('incidents/:id/events')
  async events(@Param('id') id: string) {
    return this.svc.getEvents(id);
  }

  @Get('incidents/:id/reports')
  async reports(@Param('id') id: string) {
    return this.svc.getReports(id);
  }

  @Post('incidents/:id/notes')
  @RequirePermission('note.create')
  async notes(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: NoteBody) {
    return envelope(await this.svc.addNote(id, principal, body));
  }

  @Post('incidents/:id/casualties')
  @RequirePermission('casualty.update')
  async casualties(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: CasualtyBody) {
    return envelope(await this.svc.addCasualty(id, principal, body));
  }

  @Post('incidents/:id/milestones')
  @RequirePermission('milestone.create')
  async milestones(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: MilestoneBody) {
    return envelope(await this.svc.addMilestone(id, principal, body));
  }

  @Get('incidents/:id/dispatch-recommendations')
  @RequirePermission('dispatch.create')
  async dispatchRecommendations(@Param('id') id: string) {
    return envelope(await this.svc.getDispatchRecommendations(id));
  }
}
