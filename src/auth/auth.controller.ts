import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  CreateUserDto,
  UpdateUserDto,
  CreateRoleDto,
  UpdateRoleDto,
  AssignRoleDto,
  SignupDto,
  VerifyEmailDto,
  ResendVerificationDto,
} from './auth.dto';
import { Public } from '../common/decorators/public.decorator';
// import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/roles.decorator';

// ─── AUTH CONTROLLER ──────────────────────────────────────────────────────────

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  /**
   * POST /auth/signup
   * Register a new user account. Sends a 6-digit OTP to the provided email.
   */
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @Public()
  // 5 signup attempts per IP per 10 minutes
  @Throttle({ default: { ttl: 600_000, limit: 5 } })
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  /**
   * POST /auth/verify-email
   * Verify email using the 6-digit OTP. Assigns OWNER role on success.
   */
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Public()
  // 5 OTP attempts per IP per 15 minutes — brute force protection
  // OTP space is only 900,000 combinations without this
  @Throttle({ default: { ttl: 900_000, limit: 5 } })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  /**
   * POST /auth/resend-verification
   * Resend the verification OTP email.
   */
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Public()
  // 3 resend attempts per IP per 10 minutes — prevent SMTP spam
  @Throttle({ default: { ttl: 600_000, limit: 3 } })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto);
  }

  /**
   * POST /auth/login
   * Returns accessToken + refreshToken + user info with roles and permissions.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Public()
  // 10 login attempts per IP per 15 minutes — brute force protection
  @Throttle({ default: { ttl: 900_000, limit: 10 } })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * POST /auth/refresh
   * Exchange a valid refresh token for a new access token.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Public()
  // Generous limit — legitimate clients refresh frequently
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  refresh(
    @Body() dto: RefreshTokenDto,
  ) {
    return this.authService.refresh(dto.userId, dto.refreshToken);
  }

  /**
   * POST /auth/logout
   * Clears refresh token — invalidates all sessions for this user.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  // @UseGuards(JwtAuthGuard)
  // authenticated action, no need to throttle
  @SkipThrottle()
  logout(@CurrentUser('id') userId: string) {
    return this.authService.logout(userId);
  }

  /**
   * POST /auth/change-password
   * Change password for the currently logged-in user.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  // @UseGuards(JwtAuthGuard)
  // 5 attempts per 10 minutes — prevent password guessing
  @Throttle({ default: { ttl: 600_000, limit: 5 } })
  changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto);
  }

  /**
   * POST /auth/forgot-password
   * Request a password reset token (sent via email).
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Public()
  // 3 attempts per 10 minutes — prevent SMTP spam + email enumeration
  @Throttle({ default: { ttl: 600_000, limit: 3 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  /**
   * POST /auth/reset-password
   * Reset password using token from email.
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Public()
  // 5 attempts per 10 minutes
  @Throttle({ default: { ttl: 600_000, limit: 5 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  /**
   * GET /auth/me
   * Get currently logged-in user with full permissions.
   */
  @Get('me')
  // @UseGuards(JwtAuthGuard)
  // authenticated, called frequently by frontend
  @SkipThrottle()
  me(@CurrentUser('id') userId: string) {
    return this.authService.getUser(userId);
  }
}

// ─── USER MANAGEMENT CONTROLLER ──────────────────────────────────────────────

@ApiTags('Auth')
@UseGuards(RolesGuard)
@SkipThrottle() // all routes here are authenticated + OWNER only
@Controller('users')
export class UserController {
  constructor(private readonly authService: AuthService) { }

  /**
   * POST /users
   * Create a new user and assign roles.
   * Roles: OWNER only
   */
  @Post()
  @Roles('OWNER')
  createUser(@Body() dto: CreateUserDto) {
    return this.authService.createUser(dto);
  }

  /**
   * GET /users
   * List all users with their roles.
   * Roles: OWNER
   */
  @Get()
  @Roles('OWNER')
  listUsers() {
    return this.authService.listUsers();
  }

  /**
   * GET /users/:id
   * Get user detail with roles and all permissions.
   * Roles: OWNER
   */
  @Get(':id')
  @Roles('OWNER')
  getUser(@Param('id') id: string) {
    return this.authService.getUser(id);
  }

  /**
   * PATCH /users/:id
   * Update user name, email, isActive, or replace roles.
   * Roles: OWNER
   */
  @Patch(':id')
  @Roles('OWNER')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.authService.updateUser(id, dto);
  }

  /**
   * PATCH /users/:id/roles
   * Replace all roles for a user.
   * Roles: OWNER
   */
  @Patch(':id/roles')
  @Roles('OWNER')
  assignRoles(@Param('id') id: string, @Body() dto: AssignRoleDto) {
    return this.authService.assignRoles(id, dto);
  }
}

// ─── ROLE MANAGEMENT CONTROLLER ──────────────────────────────────────────────

@ApiTags('Auth')
@UseGuards (RolesGuard)
@SkipThrottle() // all routes here are authenticated + OWNER only
@Controller('roles')
export class RoleController {
  constructor(private readonly authService: AuthService) { }

  /**
   * POST /roles
   * Create a new role with optional permissions.
   * Roles: OWNER
   */
  @Post()
  @Roles('OWNER')
  createRole(@Body() dto: CreateRoleDto) {
    return this.authService.createRole(dto);
  }

  /**
   * GET /roles
   * List all roles with their permissions and user counts.
   * Roles: OWNER
   */
  @Get()
  @Roles('OWNER')
  listRoles() {
    return this.authService.listRoles();
  }

  /**
   * PATCH /roles/:id
   * Update role description, isActive, or replace permissions.
   * Roles: OWNER
   */
  @Patch(':id')
  @Roles('OWNER')
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.authService.updateRole(id, dto);
  }

  /**
   * GET /roles/permissions
   * List all available permissions grouped by module.
   * Roles: OWNER
   */
  @Get('permissions')
  @Roles('OWNER')
  listPermissions() {
    return this.authService.listPermissions();
  }
}
