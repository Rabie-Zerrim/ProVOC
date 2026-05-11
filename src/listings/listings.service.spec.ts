import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { of } from 'rxjs';
import { ListingsService } from './listings.service';
import { PrismaService } from '../prisma/prisma.service';

const mockListing = {
  listing_id: 'uuid-listing-1',
  business_id: 'uuid-biz-1',
  network_id: 'uuid-net-1',
  external_listing_id: 'zembra-001',
  external_rating: 4.5,
  external_url: 'https://zembra.io/listing/001',
  is_active: true,
  last_synced_at: new Date(),
  created_at: new Date(),
  updated_at: new Date(),
  business: { business_id: 'uuid-biz-1', name: 'Test Business' },
  network: { network_id: 'uuid-net-1', name: 'Zembra' },
};

const mockNetwork = { network_id: 'uuid-net-1', name: 'Zembra', base_url: 'https://api.zembra.io', is_active: true };
const mockBusiness = { business_id: 'uuid-biz-1', name: 'Test Business' };

describe('ListingsService', () => {
  let service: ListingsService;
  let httpService: jest.Mocked<Pick<HttpService, 'get'>>;
  let prisma: {
    listing: { findUnique: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
    network: { findFirst: jest.Mock; create: jest.Mock };
    business: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      listing: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
      network: { findFirst: jest.fn(), create: jest.fn() },
      business: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListingsService,
        { provide: HttpService, useValue: { get: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'ZEMBRA_API_KEY') return 'test-key';
              if (key === 'ZEMBRA_BASE_URL') return 'https://api.zembra.io';
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get<ListingsService>(ListingsService);
    httpService = module.get(HttpService);
  });

  describe('search', () => {
    it('calls Zembra /listing/match with name, address and networks', async () => {
      const mockResults = [{ network: 'opentable', url: 'https://opentable.com/xyz' }];
      (httpService.get as jest.Mock).mockReturnValue(of({ data: mockResults }));

      const result = await service.search('Harmony Cuisine 2B1', '3904 Convoy St, San Diego', ['opentable']);

      const calledUrl: string = (httpService.get as jest.Mock).mock.calls[0][0];
      expect(calledUrl).toContain('/listing/match');
      expect(calledUrl).toContain('name=Harmony+Cuisine+2B1');
      expect(calledUrl).toContain('networks%5B%5D=opentable');
      expect(result).toEqual(mockResults);
    });

    it('calls Zembra without networks when not provided', async () => {
      (httpService.get as jest.Mock).mockReturnValue(of({ data: [] }));

      await service.search('Sushi Place', '123 Main St');

      const calledUrl: string = (httpService.get as jest.Mock).mock.calls[0][0];
      expect(calledUrl).toContain('/listing/match');
      expect(calledUrl).not.toContain('networks');
    });
  });

  describe('findById', () => {
    it('returns listing when found', async () => {
      prisma.listing.findUnique.mockResolvedValue(mockListing);

      const result = await service.findById('uuid-listing-1');

      expect(prisma.listing.findUnique).toHaveBeenCalledWith({
        where: { listing_id: 'uuid-listing-1' },
        include: { business: true, network: true },
      });
      expect(result).toEqual(mockListing);
    });

    it('throws NotFoundException when listing does not exist', async () => {
      prisma.listing.findUnique.mockResolvedValue(null);

      await expect(service.findById('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('save', () => {
    const dto = {
      external_listing_id: 'zembra-001',
      name: 'Test Business',
      address: '123 Main St',
      external_rating: 4.5,
      external_url: 'https://zembra.io/listing/001',
    };

    it('returns existing listing if external_listing_id already saved', async () => {
      prisma.listing.findFirst.mockResolvedValue(mockListing);

      const result = await service.save(dto);

      expect(result).toEqual(mockListing);
      expect(prisma.business.create).not.toHaveBeenCalled();
    });

    it('uses existing Zembra network when found', async () => {
      prisma.listing.findFirst.mockResolvedValue(null);
      prisma.network.findFirst.mockResolvedValue(mockNetwork);
      prisma.business.create.mockResolvedValue(mockBusiness);
      prisma.listing.create.mockResolvedValue(mockListing);

      await service.save(dto);

      expect(prisma.network.create).not.toHaveBeenCalled();
      expect(prisma.business.create).toHaveBeenCalled();
      expect(prisma.listing.create).toHaveBeenCalled();
    });

    it('creates Zembra network when not found', async () => {
      prisma.listing.findFirst.mockResolvedValue(null);
      prisma.network.findFirst.mockResolvedValue(null);
      prisma.network.create.mockResolvedValue(mockNetwork);
      prisma.business.create.mockResolvedValue(mockBusiness);
      prisma.listing.create.mockResolvedValue(mockListing);

      await service.save(dto);

      expect(prisma.network.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Zembra' }) }),
      );
    });

    it('creates listing linked to business and network', async () => {
      prisma.listing.findFirst.mockResolvedValue(null);
      prisma.network.findFirst.mockResolvedValue(mockNetwork);
      prisma.business.create.mockResolvedValue(mockBusiness);
      prisma.listing.create.mockResolvedValue(mockListing);

      const result = await service.save(dto);

      expect(prisma.listing.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            business_id: mockBusiness.business_id,
            network_id: mockNetwork.network_id,
            external_listing_id: dto.external_listing_id,
          }),
        }),
      );
      expect(result).toEqual(mockListing);
    });
  });
});
