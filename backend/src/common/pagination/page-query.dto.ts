import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DEFAULT_LIMIT, MAX_LIMIT } from './cursor';

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number = DEFAULT_LIMIT;

  @IsOptional()
  @IsString()
  cursor?: string;

  /** Sort: `-createdAt` = menurun. Kolom diizinkan ditentukan per endpoint. */
  @IsOptional()
  @IsString()
  sort?: string;

  /** Pencarian teks bebas. */
  @IsOptional()
  @IsString()
  q?: string;
}
