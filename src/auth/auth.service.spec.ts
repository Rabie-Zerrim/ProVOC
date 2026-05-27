import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConflictException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    userCredential: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let jwtService: { sign: jest.Mock };

  const mockUser = { user_id: 'uuid-user-1', display_name: 'Test User', is_active: true };
  const mockCredential = {
    credential_id: 'uuid-cred-1',
    user_id: 'uuid-user-1',
    email: 'test@example.com',
    password_hash: '$2a$10$hashed',
  };

  beforeEach(async () => {
    const txMock = {
      user: { create: jest.fn().mockResolvedValue(mockUser) },
      userCredential: { create: jest.fn().mockResolvedValue(mockCredential) },
    };

    prisma = {
      userCredential: { findUnique: jest.fn() },
      $transaction: jest.fn().mockImplementation((cb) => cb(txMock)),
    };

    jwtService = { sign: jest.fn().mockReturnValue('signed-token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should create user and credential in a transaction and return access_token', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(null);

      const result = await service.register({
        email: 'test@example.com',
        password: 'password123',
        display_name: 'Test User',
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: mockCredential.user_id,
        email: mockCredential.email,
      });
      expect(result).toEqual({ access_token: 'signed-token' });
    });

    it('should throw ConflictException (409) when email is already registered', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(mockCredential);

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'password123',
          display_name: 'Test User',
        }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});

describe('RegisterDto', () => {
  it('should fail validation when password is shorter than 8 characters', async () => {
    const dto = plainToInstance(RegisterDto, {
      email: 'test@example.com',
      password: 'short',
      display_name: 'Test User',
    });

    const errors = await validate(dto);

    const passwordError = errors.find((e) => e.property === 'password');
    expect(passwordError).toBeDefined();
    expect(passwordError?.constraints?.minLength).toBeDefined();
  });
});
