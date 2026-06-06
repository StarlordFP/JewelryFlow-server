import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'crypto';
import * as nodemailer from 'nodemailer';
import {
  LoginDto,
  SignupDto,
  VerifyEmailDto,
  ResendVerificationDto,
  CreateUserDto,
  UpdateUserDto,
  CreateRoleDto,
  UpdateRoleDto,
  AssignRoleDto,
  ChangePasswordDto,
  ResetPasswordDto,
} from './auth.dto';

const SALT_ROUNDS = 12;
const REFRESH_EXPIRY = '7d';
const ACCESS_EXPIRY = '8h';
const OTP_EXPIRY_MINUTES = 15;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) { }

  // ════════════════════════════════════════════════════════════════════════════
  //  AUTH — SIGNUP / VERIFY / LOGIN / LOGOUT / REFRESH
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Signup — creates a new user with emailVerified=false,
   * generates a 6-digit OTP, and sends it via email.
   */
  async signup(dto: SignupDto) {
    // Check if email already registered
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing && existing.emailVerified) {
      throw new ConflictException('An account with this email already exists');
    }

    // If user exists but hasn't verified, delete and let them re-register
    if (existing && !existing.emailVerified) {
      await this.prisma.user.delete({ where: { id: existing.id } });
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const otp = this.generateOtp();
    const expiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash,
        emailVerified: false,
        emailVerifyToken: otp,
        emailVerifyExpiry: expiry,
        isActive: true,
      },
    });

    // Send OTP email
    await this.sendVerificationEmail(dto.email, otp);

    return {
      message: `Verification OTP sent to ${dto.email}. Please check your inbox.`,
      email: dto.email,
    };
  }

  /**
   * Verify email — validates the 6-digit OTP and activates the user.
   * Assigns the OWNER role upon successful verification.
   */
  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new BadRequestException('No account found with this email');
    }

    if (user.emailVerified) {
      return { message: 'Email is already verified. You can log in.' };
    }

    if (!user.emailVerifyToken || !user.emailVerifyExpiry) {
      throw new BadRequestException('No pending verification. Please request a new OTP.');
    }

    if (user.emailVerifyExpiry < new Date()) {
      throw new BadRequestException('OTP has expired. Please request a new one.');
    }

    if (user.emailVerifyToken !== dto.otp) {
      throw new BadRequestException('Invalid OTP. Please try again.');
    }

    // Find or validate the OWNER role
    const ownerRole = await this.prisma.role.findUnique({
      where: { name: 'OWNER' },
    });

    // Activate user and assign OWNER role
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpiry: null,
        ...(ownerRole ? {
          userRoles: {
            create: { roleId: ownerRole.id },
          },
        } : {}),
      },
    });

    return {
      message: 'Email verified successfully! You can now log in.',
      ...(ownerRole ? {} : { warning: 'OWNER role not found in database. User created without a role.' }),
    };
  }

  /**
   * Resend verification — generates a new OTP and sends it.
   */
  async resendVerification(dto: ResendVerificationDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Always return success — don't reveal if email exists
    if (!user || user.emailVerified) {
      return { message: 'If that email has a pending verification, a new OTP has been sent.' };
    }

    const otp = this.generateOtp();
    const expiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifyToken: otp,
        emailVerifyExpiry: expiry,
      },
    });

    await this.sendVerificationEmail(dto.email, otp);

    return { message: 'If that email has a pending verification, a new OTP has been sent.' };
  }

  /**
   * Login — validates credentials, returns access + refresh tokens.
   * Refresh token is stored hashed in DB.
   */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Block login if email is not verified
    if (!user.emailVerified) {
      throw new UnauthorizedException('Please verify your email before logging in. Check your inbox for the 6-digit OTP.');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.name),
        ),
      ),
    ];

    const payload = { sub: user.id, email: user.email, roles };

    const accessToken = this.jwt.sign(payload, { expiresIn: ACCESS_EXPIRY });
    const refreshToken = this.generateRefreshToken();

    // Store hashed refresh token
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: this.hashToken(refreshToken) },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_EXPIRY,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles,
        permissions,
      },
    };
  }

  /**
   * Refresh — validates refresh token, issues new access token.
   */
  async refresh(userId: string, refreshToken: string) {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });

  if (!user || !user.isActive || !user.refreshTokenHash) {
    throw new UnauthorizedException('Invalid refresh token');
  }

  const tokenValid = this.hashToken(refreshToken) === user.refreshTokenHash;
  if (!tokenValid) {
    throw new UnauthorizedException('Invalid refresh token');
  }

  const roles   = await this.getUserRoleNames(userId);
  const payload = { sub: user.id, email: user.email, roles };

  return {
    accessToken: this.jwt.sign(payload, { expiresIn: ACCESS_EXPIRY }),
    expiresIn:   ACCESS_EXPIRY,
  };
}

  /**
   * Logout — clears refresh token from DB.
   */
  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });
    return { message: 'Logged out successfully' };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PASSWORD
  // ════════════════════════════════════════════════════════════════════════════

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, refreshTokenHash: null }, // invalidate all sessions
    });

    return { message: 'Password changed successfully' };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { message: 'If that email exists, a reset link has been sent' };

    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);   // store hash, not plaintext
    const expiry = new Date(Date.now() + 1000 * 60 * 60);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetToken: tokenHash, resetTokenExpiry: expiry },
    });

    // TODO: send email with reset link containing raw `token` (not the hash)
    // this.sendResetEmail(email, token);

    return { message: 'If that email exists, a reset link has been sent' };
  }


  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.hashToken(dto.token);  // hash the incoming token first

    const user = await this.prisma.user.findUnique({
      where: { resetToken: tokenHash },           // compare against stored hash
    });

    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiry: null,
        refreshTokenHash: null,
      },
    });

    return { message: 'Password reset successfully' };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  USER MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Create a new user and assign roles.
   * Only OWNER can create users.
   */
  async createUser(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException(`User with email ${dto.email} already exists`);
    }

    // Validate roles exist
    const roles = await this.prisma.role.findMany({
      where: { name: { in: dto.roles }, isActive: true },
    });

    if (roles.length !== dto.roles.length) {
      const found = roles.map((r) => r.name);
      const missing = dto.roles.filter((r) => !found.includes(r));
      throw new BadRequestException(`Roles not found: ${missing.join(', ')}`);
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash,
        userRoles: {
          create: roles.map((r) => ({ roleId: r.id })),
        },
      },
      include: {
        userRoles: { include: { role: true } },
      },
    });

    return this.formatUserResponse(user);
  }

  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        userRoles: { include: { role: true } },
      },
    });
    return users.map((u) => this.formatUserResponse(u));
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });

    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.formatUserResponse(user, true); // include permissions
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    await this.findUserOrThrow(id);

    return this.prisma.$transaction(async (tx) => {
      const data: any = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.email !== undefined) data.email = dto.email;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;

      // Replace roles if provided
      if (dto.roles) {
        const roles = await tx.role.findMany({
          where: { name: { in: dto.roles }, isActive: true },
        });
        if (roles.length !== dto.roles.length) {
          throw new BadRequestException('One or more roles not found');
        }

        // Delete existing roles and re-assign
        await tx.userRole.deleteMany({ where: { userId: id } });
        data.userRoles = {
          create: roles.map((r) => ({ roleId: r.id })),
        };
      }

      return tx.user.update({
        where: { id },
        data,
        include: { userRoles: { include: { role: true } } },
      });
    });
  }

  async assignRoles(userId: string, dto: AssignRoleDto) {
    await this.findUserOrThrow(userId);

    const roles = await this.prisma.role.findMany({
      where: { name: { in: dto.roles }, isActive: true },
    });

    if (roles.length !== dto.roles.length) {
      throw new BadRequestException('One or more roles not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({
        data: roles.map((r) => ({ userId, roleId: r.id })),
      });

      return tx.user.findUnique({
        where: { id: userId },
        include: { userRoles: { include: { role: true } } },
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  ROLE MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  async createRole(dto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({
      where: { name: dto.name },
    });
    if (existing) throw new ConflictException(`Role "${dto.name}" already exists`);

    let permissionIds: string[] = [];
    if (dto.permissions?.length) {
      const perms = await this.prisma.permission.findMany({
        where: { name: { in: dto.permissions } },
      });
      permissionIds = perms.map((p) => p.id);
    }

    return this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description,
        rolePermissions: {
          create: permissionIds.map((id) => ({ permissionId: id })),
        },
      },
      include: {
        rolePermissions: { include: { permission: true } },
      },
    });
  }

  async listRoles() {
    return this.prisma.role.findMany({
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException(`Role ${id} not found`);

    return this.prisma.$transaction(async (tx) => {
      const data: any = {};
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;

      if (dto.permissions) {
        const perms = await tx.permission.findMany({
          where: { name: { in: dto.permissions } },
        });
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        data.rolePermissions = {
          create: perms.map((p) => ({ permissionId: p.id })),
        };
      }

      return tx.role.update({
        where: { id },
        data,
        include: { rolePermissions: { include: { permission: true } } },
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PERMISSION MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  async listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { name: 'asc' }],
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  private generateRefreshToken(): string {
    return randomBytes(64).toString('hex');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generate a 6-digit numeric OTP.
   */
  private generateOtp(): string {
    return randomInt(100000, 1000000).toString();
  }

  /**
   * Send a verification OTP email via SMTP (nodemailer).
   */
  private async sendVerificationEmail(email: string, otp: string): Promise<void> {
    try {
      await this.transporter.sendMail({   // ← this.transporter, not local var
        from: process.env.SMTP_FROM || '"JewelryFlow" <noreply@jewelryflow.com>',
        to: email,
        subject: 'JewelryFlow — Email Verification OTP',
        text: `Your verification code is: ${otp}\n\nThis code expires in ${OTP_EXPIRY_MINUTES} minutes.\n\nIf you did not sign up for JewelryFlow, please ignore this email.`,
        html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #fafafa; border-radius: 12px;">
          <h2 style="color: #1a1a2e; margin-bottom: 8px;">Welcome to JewelryFlow ✨</h2>
          <p style="color: #555; font-size: 15px;">Use the code below to verify your email address:</p>
          <div style="background: #1a1a2e; color: #f5c542; font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; border-radius: 8px; margin: 24px 0;">
            ${otp}
          </div>
          <p style="color: #888; font-size: 13px;">This code expires in <strong>${OTP_EXPIRY_MINUTES} minutes</strong>.</p>
          <p style="color: #888; font-size: 13px;">If you did not sign up for JewelryFlow, please ignore this email.</p>
        </div>
      `,
      });
      this.logger.log(`Verification OTP sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}`, error);
      throw new BadRequestException('Failed to send verification email. Please try again later.');
    }
  }

  private async getUserRoleNames(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    return userRoles.map((ur) => ur.role.name);
  }

  private formatUserResponse(user: any, includePermissions = false) {
    const roles = user.userRoles?.map((ur: any) => ur.role.name) ?? [];

    const permissions = includePermissions
      ? [
        ...new Set(
          user.userRoles?.flatMap((ur: any) =>
            ur.role.rolePermissions?.map((rp: any) => rp.permission.name) ?? [],
          ) ?? [],
        ),
      ]
      : undefined;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      roles,
      ...(permissions ? { permissions } : {}),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private async findUserOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }
}
