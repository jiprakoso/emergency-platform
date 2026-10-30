import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AttachmentsService } from './attachments.service';
import { CreateUploadDto } from './dto/attachments.dto';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { envelope } from '../../common/envelope';

@Controller()
export class AttachmentsController {
  constructor(private readonly svc: AttachmentsService) {}

  @Post('attachments/uploads')
  async createUpload(@CurrentUser() principal: AuthPrincipal, @Body() body: CreateUploadDto) {
    return envelope(await this.svc.createUpload(principal, body));
  }

  @Post('attachments/:id/confirm')
  @HttpCode(200)
  async confirm(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal) {
    return envelope(await this.svc.confirm(id, principal));
  }

  @Get('attachments/:id/url')
  async getUrl(@Param('id') id: string, @CurrentUser() principal: AuthPrincipal) {
    return envelope(await this.svc.getUrl(id, principal));
  }
}
