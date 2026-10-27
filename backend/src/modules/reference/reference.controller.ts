import { Controller, Get, Query } from '@nestjs/common';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString } from 'class-validator';
import { ReferenceService } from './reference.service';
import { Public } from '../auth/auth.decorators';
import { envelope } from '../../common/envelope';
import { PageQueryDto } from '../../common/pagination/page-query.dto';

/** Query `GET /regions` (REST §5.2). */
class RegionsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

/** Query `GET /regions/resolve` (REST §5.2). */
class RegionResolveQueryDto {
  @IsNumber()
  @IsLatitude()
  lat!: number;

  @IsNumber()
  @IsLongitude()
  lng!: number;
}

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
  async regions(@Query() q: RegionsQueryDto) {
    const res = await this.svc.getRegions({
      level: q.level,
      parentId: q.parentId,
      limit: q.limit,
      cursor: q.cursor,
    });
    return { data: res.data, page: res.page };
  }

  @Get('regions/resolve')
  async regionsResolve(@Query() q: RegionResolveQueryDto) {
    return envelope(await this.svc.resolvePoint(q.lng, q.lat));
  }
}
