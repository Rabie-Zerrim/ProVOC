import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { ZembraService } from './zembra.service';

const makeNetworkData = (network: string, overrides: any = {}) => ({
  status: 'OK',
  [network]: {
    url: `https://example.com/${network}`,
    globalRating: 4.5,
    reviewCount: { native: { total: 100 } },
    ...overrides,
  },
});

describe('ZembraService', () => {
  let service: ZembraService;
  let httpService: { get: jest.Mock };

  beforeEach(async () => {
    httpService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZembraService,
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const env: Record<string, string> = {
                ZEMBRA_API_URL: 'https://localhost:443',
                ZEMBRA_API_TOKEN: 'test-token',
                ZEMBRA_HOST_HEADER: 'localapi.zembra.io',
              };
              return env[key] ?? '';
            },
          },
        },
      ],
    }).compile();

    service = module.get<ZembraService>(ZembraService);
  });

  describe('matchListing', () => {
    it('returns both networks when all requests succeed', async () => {
      httpService.get
        .mockReturnValueOnce(of({ data: makeNetworkData('google') }))
        .mockReturnValueOnce(of({ data: makeNetworkData('yelp') }));

      const result = await service.matchListing('Test Business', '123 Main St');

      expect(result).toEqual({
        networks: {
          google: { url: 'https://example.com/google', rating: 4.5, reviewCount: 100 },
          yelp: { url: 'https://example.com/yelp', rating: 4.5, reviewCount: 100 },
        },
      });
    });

    it('returns only google when yelp request fails', async () => {
      httpService.get
        .mockReturnValueOnce(of({ data: makeNetworkData('google') }))
        .mockReturnValueOnce(throwError(() => new Error('ECONNREFUSED')));

      const result = await service.matchListing('Test Business', '123 Main St');

      expect(result).toEqual({
        networks: {
          google: { url: 'https://example.com/google', rating: 4.5, reviewCount: 100 },
        },
      });
    });

    it('returns empty networks when all requests fail', async () => {
      httpService.get
        .mockReturnValueOnce(throwError(() => new Error('timeout')))
        .mockReturnValueOnce(throwError(() => new Error('timeout')));

      const result = await service.matchListing('Test Business', '123 Main St');

      expect(result).toEqual({ networks: {} });
    });

    it('skips network when Zembra returns status ERROR', async () => {
      httpService.get
        .mockReturnValueOnce(of({ data: { status: 'ERROR' } }))
        .mockReturnValueOnce(of({ data: makeNetworkData('yelp') }));

      const result = await service.matchListing('Test Business', '123 Main St');

      expect(result.networks).not.toHaveProperty('google');
      expect(result.networks).toHaveProperty('yelp');
    });

    it('uses zero fallback for rating and reviewCount when fields are missing', async () => {
      httpService.get
        .mockReturnValueOnce(
          of({
            data: {
              status: 'OK',
              google: { url: 'https://example.com/google' },
            },
          }),
        )
        .mockReturnValueOnce(throwError(() => new Error('timeout')));

      const result = await service.matchListing('Test Business', '123 Main St');

      expect(result.networks.google).toEqual({
        url: 'https://example.com/google',
        rating: 0,
        reviewCount: 0,
      });
    });

    it('calls the correct Zembra URL with one network per request', async () => {
      httpService.get
        .mockReturnValueOnce(of({ data: makeNetworkData('google') }))
        .mockReturnValueOnce(of({ data: makeNetworkData('yelp') }));

      await service.matchListing('My Biz', '456 Oak Ave');

      const urls: string[] = httpService.get.mock.calls.map((call: any[]) => call[0] as string);
      expect(urls[0]).toContain('/listing/match');
      expect(urls[0]).toContain('networks%5B%5D=google');
      expect(urls[0]).not.toContain('yelp');
      expect(urls[1]).toContain('networks%5B%5D=yelp');
      expect(urls[1]).not.toContain('google');
    });

    it('sends Authorization header without a Host header override on each request', async () => {
      httpService.get
        .mockReturnValueOnce(of({ data: makeNetworkData('google') }))
        .mockReturnValueOnce(of({ data: makeNetworkData('yelp') }));

      await service.matchListing('My Biz', '456 Oak Ave');

      const headers = httpService.get.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer test-token');
      expect(headers.Host).toBeUndefined();
    });
  });
});
