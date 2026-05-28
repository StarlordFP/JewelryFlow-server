import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * RolesGuard reads the `roles` metadata set by the @Roles() decorator
 * and checks whether the authenticated user's roles include any of them.
 *
 * Role names come from the JWT payload (set during login):
 *   { sub: userId, roles: ['OWNER'] }
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator → public within authenticated scope
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    const userRoles: string[] = user.roles ?? [];
    return requiredRoles.some((role) => userRoles.includes(role));
  }
}
