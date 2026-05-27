import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

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

  async register(registerDto: RegisterDto) {
    const existing = await this.prisma.userCredential.findUnique({
      where: { email: registerDto.email },
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(registerDto.password, 10);

    const credential = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          display_name: registerDto.display_name,
        },
      });

      return tx.userCredential.create({
        data: {
          user_id: user.user_id,
          email: registerDto.email,
          password_hash: passwordHash,
        },
      });
    });

    const payload = {
      sub: credential.user_id,
      email: credential.email,
    };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
