import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark an endpoint as public — skips JwtAuthGuard.
 * Used when JwtAuthGuard is registered globally via APP_GUARD.
 *
 * Usage:
 *   @Public()
 *   @Post('login')
 *   login() { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);