import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../database/entities/role.entity';
import { User } from '../../database/entities/user.entity';
import { UserRole } from '../../database/entities/user-role.entity';
import { StaffProfile } from '../../database/entities/staff-profile.entity';
import { AuthSession } from '../../database/entities/auth-session.entity';
import { ClockService } from '../../common/clock/clock.service';
import { AppError } from '../../common/errors/app-error';
import { Redis } from 'ioredis';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { PasswordService } from './providers/password.service';
import { TotpService } from './providers/totp.service';
import { TokenService } from './providers/token.service';
import { OtpService } from './providers/otp.service';
import { SessionService, SessionContext } from './providers/session.service';
import { PermissionService } from '../permissions/permission.service';
import { DeviceService } from '../me/device.service';
import { RegionLookupService } from '../me/region-lookup.service';
import {
  CitizenLoginDto,
  CitizenRegisterDto,
  DeviceInfoDto,
  StaffLogin2faDto,
  StaffLoginDto,
} from './dto/auth.dto';
import { AuthPrincipal } from './auth.types';

export type TokenPair = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
  user: { id: string; userType: 'CITIZEN' | 'STAFF'; fullName: string; roles: string[] };
};

export type StaffLoginResult = TokenPair | { twoFactorRequired: true; challengeToken: string };

const TOKEN_REVOKED_REDIS_KEY = (sessionId: string) => `session:revoked:${sessionId}`;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    @InjectRepository(StaffProfile) private readonly staffProfiles: Repository<StaffProfile>,
    private readonly password: PasswordService,
    private readonly totp: TotpService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly permissionService: PermissionService,
    private readonly devices: DeviceService,
    private readonly regionLookup: RegionLookupService,
    private readonly clock: ClockService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  // ---- Helper ----

  private async findUserByPhone(phone: string, withSecrets = false): Promise<User | null> {
    const qb = this.users.createQueryBuilder('u').where('u.phone = :phone', { phone });
    if (withSecrets) {
      qb.addSelect(['u.passwordHash', 'u.twoFactorSecret']);
    }
    return qb.getOne();
  }

  private async findStaffByIdentifier(identifier: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('u')
      .addSelect(['u.passwordHash', 'u.twoFactorSecret'])
      .where('u.phone = :id OR u.email = :id', { id: identifier })
      .andWhere("u.user_type = 'STAFF'")
      .getOne();
  }

  private async issueTokenPair(
    user: User,
    device: DeviceInfoDto,
    ctx: Pick<SessionContext, 'ipAddress' | 'userAgent'>,
    existingSession?: AuthSession | null,
  ): Promise<TokenPair> {
    const deviceRow = await this.devices.register(user, device);
    const roles = await this.permissionService.getRoles(user.id);
    const staffProfile = await this.staffProfiles.findOne({ where: { userId: user.id } });

    const refreshToken = this.tokens.generateRefreshToken();
    let session: AuthSession;
    if (existingSession) {
      await this.sessions.revokeSession(existingSession.id);
      session = await this.sessions.create(
        user.id,
        refreshToken,
        this.tokens.refreshTtlSeconds(user.userType),
        {
          ...ctx,
          deviceTokenId: deviceRow?.id ?? null,
          devicePlatform: device.platform,
          appFlavor: device.appFlavor,
          appVersion: device.appVersion,
        },
      );
    } else {
      session = await this.sessions.create(
        user.id,
        refreshToken,
        this.tokens.refreshTtlSeconds(user.userType),
        {
          ...ctx,
          deviceTokenId: deviceRow?.id ?? null,
          devicePlatform: device.platform,
          appFlavor: device.appFlavor,
          appVersion: device.appVersion,
        },
      );
    }

    const accessToken = this.tokens.signAccessToken({
      sub: user.id,
      sid: session.id,
      userType: user.userType,
      roles,
      orgId: staffProfile?.organizationId,
      unitId: staffProfile?.unitId ?? undefined,
    });

    await this.users.update({ id: user.id }, { lastLoginAt: this.clock.now() });

    return {
      accessToken,
      accessTokenExpiresIn: this.tokens.accessTtlSeconds,
      refreshToken,
      refreshTokenExpiresIn: this.tokens.refreshTtlSeconds(user.userType),
      user: { id: user.id, userType: user.userType, fullName: user.fullName, roles },
    };
  }

  private async assignRole(userId: string, code: string): Promise<void> {
    const role = await this.roles.findOne({ where: { code } });
    if (!role) throw AppError.internal(`Role ${code} tidak ditemukan. Jalankan seed.`);
    await this.userRoles.save(this.userRoles.create({ userId, roleId: role.id }));
  }

  // ---- Warga ----

  async citizenRegister(dto: CitizenRegisterDto, ctx: SessionContext): Promise<TokenPair> {
    await this.otp.verify(dto.phone, 'REGISTER', dto.otpCode);

    const existing = await this.findUserByPhone(dto.phone);
    if (existing) {
      throw AppError.validation('Nomor telepon sudah terdaftar.', [
        { field: 'phone', issue: 'already_exists' },
      ]);
    }

    const now = this.clock.now();
    let homeRegionId: string | null = null;
    if (dto.homeLocation) {
      const resolved = await this.regionLookup.resolve(dto.homeLocation.lng, dto.homeLocation.lat);
      homeRegionId = resolved.village?.id ?? null;
    }

    const user = await this.users.save(
      this.users.create({
        userType: 'CITIZEN',
        fullName: dto.fullName,
        phone: dto.phone,
        phoneVerifiedAt: now,
        email: null,
        passwordHash: null,
        twoFactorEnabled: false,
        twoFactorSecret: null,
        mustChangePassword: false,
        homeLocation: null,
        homeAddress: null,
        homeRegionId,
        status: 'ACTIVE',
        reputationScore: 0,
        lastLoginAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    if (dto.homeLocation) {
      await this.users.query(
        `UPDATE users SET home_location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE id = $3`,
        [dto.homeLocation.lng, dto.homeLocation.lat, user.id],
      );
    }
    await this.assignRole(user.id, 'CITIZEN');

    return this.issueTokenPair(user, dto.device, ctx);
  }

  async citizenLogin(dto: CitizenLoginDto, ctx: SessionContext): Promise<TokenPair> {
    await this.otp.verify(dto.phone, 'LOGIN', dto.otpCode);

    const user = await this.findUserByPhone(dto.phone);
    if (!user || user.userType !== 'CITIZEN') {
      throw AppError.unauthenticated('Nomor telepon atau kode OTP salah.');
    }
    this.assertAccountActive(user);

    return this.issueTokenPair(user, dto.device, ctx);
  }

  // ---- Staf ----

  async staffLogin(dto: StaffLoginDto, ctx: SessionContext): Promise<StaffLoginResult> {
    const user = await this.findStaffByIdentifier(dto.identifier);
    if (!user) {
      throw AppError.unauthenticated('Pengidentifikasi atau kata sandi salah.');
    }
    const ok = await this.password.verify(dto.password, user.passwordHash);
    if (!ok) {
      throw AppError.unauthenticated('Pengidentifikasi atau kata sandi salah.');
    }
    this.assertAccountActive(user);

    const roles = await this.permissionService.getRoles(user.id);
    const requires2fa =
      user.twoFactorEnabled || roles.includes('DISPATCHER') || roles.includes('SUPERVISOR');

    if (requires2fa && user.twoFactorEnabled) {
      const challengeToken = this.tokens.signTwoFactorChallenge({
        sub: user.id,
        device: dto.device,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      return { twoFactorRequired: true, challengeToken };
    }

    // 2FA belum didaftarkan: izinkan masuk (sampel); produksi memaksa pendaftaran.
    return this.issueTokenPair(user, dto.device, ctx);
  }

  async staffLogin2fa(dto: StaffLogin2faDto, ctx: SessionContext): Promise<TokenPair> {
    let payload: { sub: string; device: unknown };
    try {
      payload = this.tokens.verifyTwoFactorChallenge(dto.challengeToken);
    } catch {
      throw new AppError('TWO_FACTOR_INVALID', 'Challenge 2FA tidak valid atau kedaluwarsa.');
    }

    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.twoFactorSecret')
      .where('u.id = :id', { id: payload.sub })
      .getOne();
    if (!user || !user.twoFactorSecret) {
      throw new AppError('TWO_FACTOR_INVALID', '2FA belum terdaftar untuk akun ini.');
    }
    if (!this.totp.verify(dto.code, user.twoFactorSecret)) {
      throw new AppError('TWO_FACTOR_INVALID', 'Kode 2FA salah.');
    }
    this.assertAccountActive(user);

    const device = payload.device as DeviceInfoDto;
    return this.issueTokenPair(user, device, {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  // ---- Refresh / logout / sesi ----

  async refresh(refreshToken: string): Promise<TokenPair> {
    const newRefreshToken = this.tokens.generateRefreshToken();
    const session = await this.sessions.rotate(refreshToken, newRefreshToken);

    const user = await this.users.findOne({ where: { id: session.userId } });
    if (!user) throw AppError.unauthenticated();
    this.assertAccountActive(user);

    const roles = await this.permissionService.getRoles(user.id);
    const staffProfile = await this.staffProfiles.findOne({ where: { userId: user.id } });
    const accessToken = this.tokens.signAccessToken({
      sub: user.id,
      sid: session.id,
      userType: user.userType,
      roles,
      orgId: staffProfile?.organizationId,
      unitId: staffProfile?.unitId ?? undefined,
    });

    return {
      accessToken,
      accessTokenExpiresIn: this.tokens.accessTtlSeconds,
      refreshToken: newRefreshToken,
      refreshTokenExpiresIn: this.tokens.refreshTtlSeconds(user.userType),
      user: { id: user.id, userType: user.userType, fullName: user.fullName, roles },
    };
  }

  async logout(principal: AuthPrincipal): Promise<void> {
    const session = await this.sessions.getActive(principal.userId, principal.sessionId);
    if (session) {
      const full = await this.sessions.getSessionWithHash(session.id);
      await this.sessions.logout(full ?? session);
    }
    await this.redis.set(TOKEN_REVOKED_REDIS_KEY(principal.sessionId), '1', 'EX', 86400);
  }

  async listSessions(userId: string): Promise<AuthSession[]> {
    return this.sessions.listActive(userId);
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.sessions.getActive(userId, sessionId);
    if (!session) throw AppError.notFound();
    await this.sessions.revokeSession(sessionId);
    await this.redis.set(TOKEN_REVOKED_REDIS_KEY(sessionId), '1', 'EX', 86400);
  }

  // ---- Kata sandi & 2FA ----

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user || !user.passwordHash) {
      throw AppError.forbidden('Akun ini tidak memakai kata sandi.');
    }
    if (!(await this.password.verify(currentPassword, user.passwordHash))) {
      throw AppError.unauthenticated('Kata sandi saat ini salah.');
    }
    await this.users.update(
      { id: userId },
      { passwordHash: await this.password.hash(newPassword), mustChangePassword: false },
    );
  }

  async setupTwoFactor(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw AppError.notFound();
    const secret = this.totp.generateSecret();
    const account = user.email ?? user.phone;
    const otpauthUri = this.totp.keyUri(account, secret);
    // Simpan sementara; aktif setelah `enable` terverifikasi.
    await this.users.update({ id: userId }, { twoFactorSecret: secret });
    return { secret, otpauthUri };
  }

  async enableTwoFactor(userId: string, code: string): Promise<void> {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.twoFactorSecret')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user || !user.twoFactorSecret) {
      throw new AppError('TWO_FACTOR_INVALID', 'Mulai pendaftaran 2FA terlebih dahulu.');
    }
    if (!this.totp.verify(code, user.twoFactorSecret)) {
      throw new AppError('TWO_FACTOR_INVALID', 'Kode 2FA salah.');
    }
    await this.users.update({ id: userId }, { twoFactorEnabled: true });
  }

  private assertAccountActive(user: User): void {
    if (user.status === 'DEACTIVATED') {
      throw new AppError('ACCOUNT_DEACTIVATED', 'Akun dinonaktifkan.');
    }
    if (user.status === 'SUSPENDED') {
      throw new AppError('ACCOUNT_DEACTIVATED', 'Akun ditangguhkan.');
    }
  }
}
