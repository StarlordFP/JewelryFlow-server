import { SetMetadata } from '@nestjs/common';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// ─── @Roles() ────────────────────────────────────────────────────────────────

export const ROLES_KEY = 'roles';

/**
 * Usage: @Roles('OWNER', 'MANAGER')
 * Applied at controller class or handler method level.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

// ─── @CurrentUser() ───────────────────────────────────────────────────────────

/**
 * Extracts the authenticated user (or a field of it) from the request.
 *
 * Usage:
 *   @CurrentUser() user: JwtPayload
 *   @CurrentUser('id') userId: string
 */
export const CurrentUser = createParamDecorator(
  (field: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return field ? user?.[field] : user;
  },
);
