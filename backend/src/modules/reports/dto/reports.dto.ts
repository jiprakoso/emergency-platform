import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

class CoordinatesDto {
  @IsNumber()
  @Type(() => Number)
  lat!: number;

  @IsNumber()
  @Type(() => Number)
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  accuracyM?: number;
}

export class CreateReportDto {
  @IsUUID()
  clientReportId!: string;

  @IsEnum(['HELP_REQUEST', 'CONDITION_REPORT'])
  reportKind!: 'HELP_REQUEST' | 'CONDITION_REPORT';

  @IsString()
  typeCode!: string;

  @ValidateNested()
  @Type(() => CoordinatesDto)
  location!: CoordinatesDto;

  @IsOptional()
  @IsString()
  addressText?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['NONE', 'ONE', 'TWO', 'THREE_OR_MORE', 'MANY', 'UNKNOWN'])
  victimHint?: string;

  @IsOptional()
  occurredAt?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}

export class FollowUpDto {
  @IsUUID()
  clientReportId!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinatesDto)
  location?: CoordinatesDto;

  @IsOptional()
  @IsEnum(['NONE', 'ONE', 'TWO', 'THREE_OR_MORE', 'MANY', 'UNKNOWN'])
  victimHint?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}

export class WithdrawDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
