import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service'; 
import { AuthController, UserController, RoleController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret:       process.env.JWT_SECRET,
      signOptions:  { expiresIn: '8h' },
    }),
  ],
  controllers: [AuthController, UserController, RoleController],
  providers:   [AuthService, JwtStrategy],
  exports:     [AuthService, JwtStrategy],
})
export class AuthModule {}
