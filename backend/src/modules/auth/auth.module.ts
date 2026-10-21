import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './providers/password.service';
import { TotpService } from './providers/totp.service';
import { TokenService } from './providers/token.service';
import { OtpService } from './providers/otp.service';
import { SessionService } from './providers/session.service';
import { MockOtpProvider } from './providers/mock-otp.provider';
import { OTP_PROVIDER } from './providers/otp-provider';
import { User } from '../../database/entities/user.entity';
import { Role } from '../../database/entities/role.entity';
import { UserRole } from '../../database/entities/user-role.entity';
import { StaffProfile } from '../../database/entities/staff-profile.entity';
import { AuthSession } from '../../database/entities/auth-session.entity';
import { DeviceToken } from '../../database/entities/device-token.entity';
import { OtpRequest } from '../../database/entities/otp-request.entity';
import { MeModule } from '../me/me.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Role,
      UserRole,
      StaffProfile,
      AuthSession,
      DeviceToken,
      OtpRequest,
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('AUTH_JWT_SECRET', 'dev-jwt-secret-change-me'),
        signOptions: { issuer: 'emergency-platform' },
      }),
    }),
    MeModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PasswordService,
    TotpService,
    OtpService,
    SessionService,
    JwtAuthGuard,
    MockOtpProvider,
    { provide: OTP_PROVIDER, useExisting: MockOtpProvider },
  ],
  exports: [AuthService, TokenService, JwtAuthGuard],
})
export class AuthModule {}
