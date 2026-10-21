import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CoordinatesDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracyM?: number;
}

export class DeviceInfoDto {
  @IsEnum(['ANDROID', 'IOS', 'WEB'])
  platform!: 'ANDROID' | 'IOS' | 'WEB';

  @IsEnum(['CITIZEN', 'STAFF'])
  appFlavor!: 'CITIZEN' | 'STAFF';

  @IsString()
  @MaxLength(20)
  appVersion!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fcmToken?: string;

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;
}

export class OtpRequestDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsEnum(['REGISTER', 'LOGIN'])
  purpose!: 'REGISTER' | 'LOGIN';
}

export class CitizenRegisterDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  otpCode!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  fullName!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinatesDto)
  homeLocation?: CoordinatesDto;

  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device!: DeviceInfoDto;
}

export class CitizenLoginDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  otpCode!: string;

  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device!: DeviceInfoDto;
}

export class StaffLoginDto {
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device!: DeviceInfoDto;
}

export class StaffLogin2faDto {
  @IsString()
  @IsNotEmpty()
  challengeToken!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class PasswordChangeDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class TwoFactorEnableDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}
