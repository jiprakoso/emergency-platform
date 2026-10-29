import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateUploadDto {
  @IsString()
  fileName!: string;

  @IsString()
  mimeType!: string;

  @IsInt()
  @Type(() => Number)
  @Min(1)
  sizeBytes!: number;

  @IsEnum(['IMAGE', 'VIDEO', 'DOCUMENT'])
  kind!: 'IMAGE' | 'VIDEO' | 'DOCUMENT';

  @IsEnum(['REPORT', 'INCIDENT', 'DISPATCH'])
  purpose!: 'REPORT' | 'INCIDENT' | 'DISPATCH';

  @IsOptional()
  @IsUUID()
  ownerId?: string | null;
}
