import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub:   string;   // userId
  email: string;
  roles: string[]; // role names e.g. ["OWNER"]
  iat?:  number;
  exp?:  number;
}

/**
 * JwtStrategy
 *
 * Validates the Bearer token on every protected request.
 * Attaches { id, email, roles } to request.user.
 * RolesGuard reads request.user.roles to enforce RBAC.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:      process.env.JWT_SECRET!,
    });
  }

  async validate(payload: JwtPayload) {
    // Verify user still exists and is active on every request
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id:       true,
        email:    true,
        isActive: true,
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Return object that becomes request.user
    return {
      id:    user.id,
      email: user.email,
      roles: user.userRoles.map((ur) => ur.role.name),
    };
  }
}
