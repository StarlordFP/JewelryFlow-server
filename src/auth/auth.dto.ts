import {
  IsString,
  IsEmail,
  IsOptional,
  IsBoolean,
  IsArray,
  MinLength,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';

// ─── AUTH ─────────────────────────────────────────────────────────────────────

export class LoginDto {
  /** User email address. Example: "owner@jewelryflow.com" */
  @IsEmail()
  email!: string;

  /** User password (plaintext — hashed on server). Example: "MyPass123!" */
  @IsString()
  @MinLength(6)
  password!: string;
}

export class RefreshTokenDto {
  /** Refresh token received from login response */
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  /** Reset token received via email */
  @IsString()
  token!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

export class SignupDto {
  /** Full name of the user. Example: "Ram Bahadur" */
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /** Email address. Example: "user@example.com" */
  @IsEmail()
  email!: string;

  /** Password — minimum 6 characters */
  @IsString()
  @MinLength(6)
  password!: string;
}

export class VerifyEmailDto {
  /** Email address used during signup */
  @IsEmail()
  email!: string;

  /** 6-digit OTP code received via email */
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  otp!: string;
}

export class ResendVerificationDto {
  /** Email address used during signup */
  @IsEmail()
  email!: string;
}


// ─── USER ─────────────────────────────────────────────────────────────────────

export class CreateUserDto {
  /** Full name of the user. Example: "Ram Bahadur" */
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /** Unique email address. Example: "staff@jewelryflow.com" */
  @IsEmail()
  email!: string;

  /** Password — minimum 6 characters */
  @IsString()
  @MinLength(6)
  password!: string;

  /** Role names to assign. Example: ["MANAGER"] */
  @IsArray()
  @IsString({ each: true })
  roles!: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Replace all current roles with these */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];
}

// ─── ROLE ─────────────────────────────────────────────────────────────────────

export class CreateRoleDto {
  /** Role name — uppercase. Example: "MANAGER" */
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  /** Permission names to assign. Example: ["stock:create", "stock:view"] */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Replace all current permissions with these */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

export class AssignRoleDto {
  /** Role names to assign to the user */
  @IsArray()
  @IsString({ each: true })
  roles!: string[];
}
