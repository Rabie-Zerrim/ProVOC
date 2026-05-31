import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { of } from 'rxjs';
import { FacebookService } from './facebook.service';
import { PrismaService } from '../prisma/prisma.service';

const MOCK_NETWORK = {
  network_id: '00000004-0000-0000-0000-000000000000',
  name: 'Facebook',
};

describe('FacebookService', () => {
  let service: FacebookService;
  let httpService: { get: jest.Mock; post: jest.Mock };
  let prisma: {
    network: { findFirst: jest.Mock };
    userPlatformAccount: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      network: { findFirst: jest.fn() },
      userPlatformAccount: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacebookService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'FACEBOOK_APP_ID') return 'test-app-id';
              if (key === 'FACEBOOK_APP_SECRET') return 'test-app-secret';
              if (key === 'FACEBOOK_REDIRECT_URI') return 'http://localhost:3001/auth/facebook/callback';
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get<FacebookService>(FacebookService);
    httpService = module.get(HttpService);
  });

  describe('getAuthUrl', () => {
    it('should return a URL pointing to the Facebook OAuth dialog', () => {
      const url = service.getAuthUrl('user-abc');
      expect(url).toContain('https://www.facebook.com/v21.0/dialog/oauth');
    });

    it('should include public_profile and user_posts in the scope', () => {
      const url = service.getAuthUrl('user-abc');
      expect(url).toContain('public_profile');
      expect(url).toContain('user_posts');
    });

    it('should include the userId as the state param for CSRF protection', () => {
      const url = service.getAuthUrl('user-abc');
      expect(url).toContain('state=user-abc');
    });

    it('should include the configured app client_id', () => {
      const url = service.getAuthUrl('user-abc');
      expect(url).toContain('client_id=test-app-id');
    });
  });

  describe('handleCallback', () => {
    it('should exchange the code and create a new platform account', async () => {
      (httpService.get as jest.Mock)
        .mockReturnValueOnce(of({ data: { access_token: 'fb-token-123', expires_in: 5183944 } }))
        .mockReturnValueOnce(of({ data: { id: 'fb-user-456' } }));

      prisma.network.findFirst.mockResolvedValue(MOCK_NETWORK);
      prisma.userPlatformAccount.findFirst.mockResolvedValue(null);
      prisma.userPlatformAccount.create.mockResolvedValue({ account_id: 'acc-1' });

      await service.handleCallback('auth-code', 'user-abc');

      expect(prisma.userPlatformAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'user-abc',
            network_id: MOCK_NETWORK.network_id,
            oauth_token: 'fb-token-123',
            external_user_id: 'fb-user-456',
            is_active: true,
          }),
        }),
      );
      expect(prisma.userPlatformAccount.update).not.toHaveBeenCalled();
    });

    it('should update an existing platform account instead of creating a duplicate', async () => {
      (httpService.get as jest.Mock)
        .mockReturnValueOnce(of({ data: { access_token: 'new-token', expires_in: 5183944 } }))
        .mockReturnValueOnce(of({ data: { id: 'fb-user-456' } }));

      const existing = { account_id: 'acc-existing', user_id: 'user-abc', network_id: MOCK_NETWORK.network_id };
      prisma.network.findFirst.mockResolvedValue(MOCK_NETWORK);
      prisma.userPlatformAccount.findFirst.mockResolvedValue(existing);
      prisma.userPlatformAccount.update.mockResolvedValue({ ...existing, oauth_token: 'new-token' });

      await service.handleCallback('auth-code', 'user-abc');

      expect(prisma.userPlatformAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { account_id: 'acc-existing' },
          data: expect.objectContaining({
            oauth_token: 'new-token',
            external_user_id: 'fb-user-456',
          }),
        }),
      );
      expect(prisma.userPlatformAccount.create).not.toHaveBeenCalled();
    });

    it('should throw HttpException when the Facebook network is not seeded', async () => {
      (httpService.get as jest.Mock)
        .mockReturnValueOnce(of({ data: { access_token: 'fb-token' } }))
        .mockReturnValueOnce(of({ data: { id: 'fb-user-456' } }));

      prisma.network.findFirst.mockResolvedValue(null);

      await expect(service.handleCallback('auth-code', 'user-abc')).rejects.toThrow(HttpException);
    });
  });
});
