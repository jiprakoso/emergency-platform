import { Controller, Delete, Get, Param, Post, Put, Query, Body, HttpCode } from '@nestjs/common';
import { IncidentsService } from './incidents.service';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { envelope } from '../../common/envelope';
import { RequirePermission } from '../permissions/permission.decorators';

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
  async lock(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: any) {
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
  async verify(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: any) {
    const res = await this.svc.verify(id, principal, body);
    return envelope(res);
  }

  @Post('incidents/:id/invalidate')
  @RequirePermission('incident.invalidate')
  async invalidate(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: any) {
    const res = await this.svc.invalidate(id, principal, body);
    return envelope(res);
  }

  @Post('incidents/:id/merge')
  @RequirePermission('incident.merge')
  async merge(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: any) {
    const res = await this.svc.merge(id, principal, body);
    return envelope(res);
  }

  @Put('incidents/:id/lead')
  @RequirePermission('incident.set_lead')
  async lead(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: any) {
    const res = await this.svc.setLead(id, principal, body);
    return envelope(res);
  }

  @Post('incidents/:id/resolve')
  @RequirePermission('incident.close')
  async resolve(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: any) {
    const res = await this.svc.resolve(id, principal, body);
    return envelope(res);
  }

  @Post('incidents/:id/close')
  @RequirePermission('incident.close')
  async close(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal, @Body() body?: any) {
    const res = await this.svc.close(id, principal, body);
    return envelope(res);
  }

  @Get('incidents/:id/nearby')
  async nearby(@Param('id') id: string, @Query('radiusM') radiusM?: string, @Query('hours') hours?: string) {
    const res = await this.svc.nearby(id, radiusM ? parseInt(radiusM) : 300, hours ? parseInt(hours) : 6);
    return envelope(res);
  }
}
