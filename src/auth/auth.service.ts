import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const credential = await this.prisma.userCredential.findUnique({
      where: { email: loginDto.email },
      include: { user: true },
    });

    if (!credential) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      credential.password_hash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!credential.user.is_active) {
      throw new UnauthorizedException('Account is inactive');
    }

    const payload = {
      sub: credential.user_id,
      email: credential.email,
    };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
