import { Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CoordinatesDto } from '../../auth/dto/auth.dto';

export class PatchMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinatesDto)
  homeLocation?: CoordinatesDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  homeAddress?: string;
}
