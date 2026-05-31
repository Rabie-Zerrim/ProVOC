import { Test, TestingModule } from '@nestjs/testing';
import { NetworksService } from './networks.service';
import { PrismaService } from '../prisma/prisma.service';

const mockNetworkGoogle = {
  network_id: 'uuid-net-google',
  name: 'Google',
  is_active: true,
  preferences: { post_auth_type: 'clipboard_deeplink' },
};

const mockNetworkFacebook = {
  network_id: 'uuid-net-facebook',
  name: 'Facebook',
  is_active: true,
  preferences: { post_auth_type: 'api_oauth' },
};

const mockNetworkNoPrefs = {
  network_id: 'uuid-net-nopref',
  name: 'OpenTable',
  is_active: true,
  preferences: null,
};

describe('NetworksService', () => {
  let service: NetworksService;
  let prisma: { network: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      network: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NetworksService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<NetworksService>(NetworksService);
  });

  describe('findAll', () => {
    it('returns active networks with correct shape (network_id, name, slug, post_auth_type)', async () => {
      prisma.network.findMany.mockResolvedValue([mockNetworkFacebook, mockNetworkGoogle]);

      const result = await service.findAll();

      expect(prisma.network.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { is_active: true } }),
      );
      expect(result).toEqual([
        {
          network_id: 'uuid-net-facebook',
          name: 'Facebook',
          slug: 'facebook',
          post_auth_type: 'api_oauth',
        },
        {
          network_id: 'uuid-net-google',
          name: 'Google',
          slug: 'google',
          post_auth_type: 'clipboard_deeplink',
        },
      ]);
    });

    it('derives slug as lowercased name with spaces removed', async () => {
      prisma.network.findMany.mockResolvedValue([
        { ...mockNetworkGoogle, name: 'Trip Advisor', network_id: 'uuid-net-ta', preferences: null },
      ]);

      const result = await service.findAll();

      expect(result[0].slug).toBe('tripadvisor');
    });

    it('returns null for post_auth_type when network has no preferences row', async () => {
      prisma.network.findMany.mockResolvedValue([mockNetworkNoPrefs]);

      const result = await service.findAll();

      expect(result[0].post_auth_type).toBeNull();
    });

    it('returns empty array when no active networks exist', async () => {
      prisma.network.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });
});
