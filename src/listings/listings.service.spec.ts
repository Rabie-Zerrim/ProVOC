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
  network: { network_id: 'uuid-net-1', name: 'Google' },
};

const mockNetwork = { network_id: 'uuid-net-1', name: 'Google', base_url: 'https://api.zembra.io', is_active: true };
const mockBusiness = { business_id: 'uuid-biz-1', name: 'Test Business' };
const mockPrefs = { network_pref_id: 'uuid-prefs-1', network_id: 'uuid-net-1' };

describe('ListingsService', () => {
  let service: ListingsService;
  let httpService: jest.Mocked<Pick<HttpService, 'get' | 'post'>>;
  let prisma: {
    listing: { findUnique: jest.Mock; findFirst: jest.Mock; create: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    network: { findFirst: jest.Mock; create: jest.Mock };
    networkPreference: { findUnique: jest.Mock; create: jest.Mock };
    business: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      listing: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      network: { findFirst: jest.fn(), create: jest.fn() },
      networkPreference: { findUnique: jest.fn(), create: jest.fn() },
      business: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListingsService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'GOOGLE_PLACES_API_KEY') return 'test-google-key';
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
    it('calls Google Places Text Search and maps response correctly', async () => {
      const mockPlace = {
        id: 'ChIJabc123',
        displayName: { text: 'Test Restaurant' },
        formattedAddress: '123 Main St, San Diego, CA',
        rating: 4.5,
        location: { latitude: 32.7157, longitude: -117.1611 },
        photos: [{ name: 'places/ChIJabc123/photos/photo1' }],
      };
      (httpService.post as jest.Mock).mockReturnValue(of({ data: { places: [mockPlace] } }));

      const result = await service.search('restaurants San Diego');

      const calledUrl: string = (httpService.post as jest.Mock).mock.calls[0][0];
      expect(calledUrl).toContain('places.googleapis.com/v1/places:searchText');
      expect(calledUrl).toContain('key=test-google-key');
      expect(result).toEqual({
        google: {
          id: 'ChIJabc123',
          name: 'Test Restaurant',
          formattedAddress: '123 Main St, San Diego, CA',
          globalRating: 4.5,
          reviewCount: 0,
          url: '',
          photo_reference: 'places/ChIJabc123/photos/photo1',
        },
      });
    });

    it('includes locationBias when lat and lng are provided', async () => {
      (httpService.post as jest.Mock).mockReturnValue(of({ data: { places: [] } }));

      await service.search('sushi', '32.7157', '-117.1611');

      const calledBody = (httpService.post as jest.Mock).mock.calls[0][1];
      expect(calledBody.textQuery).toBe('sushi');
      expect(calledBody.locationBias.circle.center).toEqual({
        latitude: 32.7157,
        longitude: -117.1611,
      });
    });
  });

  describe('findById', () => {
    it('returns listing with networks when found', async () => {
      prisma.listing.findUnique.mockResolvedValue(mockListing);
      prisma.listing.findMany.mockResolvedValue([]);

      const result = await service.findById('uuid-listing-1');

      expect(prisma.listing.findUnique).toHaveBeenCalledWith({
        where: { listing_id: 'uuid-listing-1' },
        include: { business: true, network: true },
      });
      expect(result).toMatchObject({ listing_id: 'uuid-listing-1', networks: [] });
    });

    it('always returns networks array even when business has no other active listings', async () => {
      prisma.listing.findUnique.mockResolvedValue(mockListing);
      prisma.listing.findMany.mockResolvedValue([]);

      const result = await service.findById('uuid-listing-1');

      expect(Array.isArray(result.networks)).toBe(true);
      expect(result.networks).toEqual([]);
    });

    it('returns populated networks when business has active listings', async () => {
      prisma.listing.findUnique.mockResolvedValue(mockListing);
      prisma.listing.findMany.mockResolvedValue([
        {
          ...mockListing,
          network: { network_id: 'uuid-net-1', name: 'Google' },
        },
        {
          ...mockListing,
          listing_id: 'uuid-listing-2',
          network: { network_id: 'uuid-net-2', name: 'Trip Advisor' },
        },
      ]);

      const result = await service.findById('uuid-listing-1');

      expect(result.networks).toHaveLength(2);
      expect(result.networks[0]).toEqual(
        expect.objectContaining({ network_id: 'uuid-net-1', name: 'Google', slug: 'google' }),
      );
      expect(result.networks[1]).toEqual(
        expect.objectContaining({ network_id: 'uuid-net-2', name: 'Trip Advisor', slug: 'tripadvisor' }),
      );
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

    it('returns existing listing with networks if external_listing_id already saved', async () => {
      prisma.listing.findFirst.mockResolvedValue(mockListing);
      prisma.listing.findMany.mockResolvedValue([]);

      const result = await service.save(dto);

      expect(prisma.business.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({ listing_id: 'uuid-listing-1', networks: [] });
    });

    it('uses existing Google network when found', async () => {
      prisma.listing.findFirst.mockResolvedValue(null);
      prisma.network.findFirst.mockResolvedValue(mockNetwork);
      prisma.networkPreference.findUnique.mockResolvedValue(mockPrefs);
      prisma.business.create.mockResolvedValue(mockBusiness);
      prisma.listing.create.mockResolvedValue(mockListing);
      prisma.listing.findMany.mockResolvedValue([]);

      await service.save(dto);

      expect(prisma.network.create).not.toHaveBeenCalled();
      expect(prisma.business.create).toHaveBeenCalled();
      expect(prisma.listing.create).toHaveBeenCalled();
    });

    it('creates Google network when not found', async () => {
      prisma.listing.findFirst.mockResolvedValue(null);
      prisma.network.findFirst.mockResolvedValue(null);
      prisma.network.create.mockResolvedValue(mockNetwork);
      prisma.networkPreference.findUnique.mockResolvedValue(null);
      prisma.networkPreference.create.mockResolvedValue(mockPrefs);
      prisma.business.create.mockResolvedValue(mockBusiness);
      prisma.listing.create.mockResolvedValue(mockListing);
      prisma.listing.findMany.mockResolvedValue([]);

      await service.save(dto);

      expect(prisma.network.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Google' }) }),
      );
    });

    it('resolves network_slug to existing network without calling ensureNetwork', async () => {
      prisma.listing.findFirst.mockResolvedValue(null);
      prisma.network.findFirst.mockResolvedValue(mockNetwork);
      prisma.business.create.mockResolvedValue(mockBusiness);
      prisma.listing.create.mockResolvedValue(mockListing);
      prisma.listing.findMany.mockResolvedValue([]);

      const result = await service.save({ ...dto, network_slug: 'google' });

      expect(prisma.network.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ name: expect.objectContaining({ equals: 'Google' }) }),
        }),
      );
      expect(prisma.network.create).not.toHaveBeenCalled();
      expect(prisma.networkPreference.findUnique).not.toHaveBeenCalled();
      expect(prisma.listing.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ network_id: mockNetwork.network_id }),
        }),
      );
      expect(result).toMatchObject({ listing_id: 'uuid-listing-1', networks: [] });
    });

    it('creates listing linked to business and network', async () => {
      prisma.listing.findFirst.mockResolvedValue(null);
      prisma.network.findFirst.mockResolvedValue(mockNetwork);
      prisma.networkPreference.findUnique.mockResolvedValue(mockPrefs);
      prisma.business.create.mockResolvedValue(mockBusiness);
      prisma.listing.create.mockResolvedValue(mockListing);
      prisma.listing.findMany.mockResolvedValue([]);

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
      expect(result).toMatchObject({ listing_id: 'uuid-listing-1', networks: [] });
    });
  });
});
