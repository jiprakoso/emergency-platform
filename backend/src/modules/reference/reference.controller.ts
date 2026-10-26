import { Controller, Get, Param, Query } from '@nestjs/common';
import { ReferenceService } from './reference.service';
import { Public } from '../auth/auth.decorators';
import { envelope } from '../../common/envelope';
import { PageQueryDto } from '../../common/pagination/page-query.dto';

@Controller()
export class ReferenceController {
  constructor(private readonly svc: ReferenceService) {}

  @Get('config/public')
  @Public()
  async configPublic() {
    return envelope(await this.svc.getPublicConfig());
  }

  @Get('incident-types')
  async incidentTypes() {
    return envelope(await this.svc.getIncidentTypes());
  }

  @Get('regions')
  async regions(@Query() q: PageQueryDto & { level?: string; parentId?: string }) {
    const res = await this.svc.getRegions({ level: q.level, parentId: q.parentId, limit: q.limit, cursor: q.cursor });
    return { data: res.data, page: res.page };
  }

  @Get('regions/:id')
  async regionById(@Param('id') id: string) {
    return envelope(await this.svc.getRegionsById(id));
  }
}
