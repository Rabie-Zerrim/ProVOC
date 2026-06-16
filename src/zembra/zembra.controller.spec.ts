import { Test, TestingModule } from '@nestjs/testing';
import { ZembraController } from './zembra.controller';
import { ZembraService } from './zembra.service';

describe('ZembraController', () => {
  let controller: ZembraController;
  let zembraService: { matchListing: jest.Mock };

  beforeEach(async () => {
    zembraService = { matchListing: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ZembraController],
      providers: [{ provide: ZembraService, useValue: zembraService }],
    }).compile();

    controller = module.get<ZembraController>(ZembraController);
  });

  it('returns matchListing result for the given name and address', async () => {
    const mockResult = {
      networks: {
        google: { url: 'https://google.com/maps/place?cid=1', rating: 4.5, reviewCount: 200 },
      },
    };
    zembraService.matchListing.mockResolvedValue(mockResult);

    const result = await controller.match('Test Business', '123 Main St');

    expect(zembraService.matchListing).toHaveBeenCalledWith('Test Business', '123 Main St');
    expect(result).toEqual(mockResult);
  });

  it('returns { networks: {} } when zembraService.matchListing throws', async () => {
    zembraService.matchListing.mockRejectedValue(new Error('Zembra unreachable'));

    const result = await controller.match('Test Business', '123 Main St');

    expect(result).toEqual({ networks: {} });
  });

  it('returns { networks: {} } when Zembra finds no matches', async () => {
    zembraService.matchListing.mockResolvedValue({ networks: {} });

    const result = await controller.match('Unknown Biz', 'Nowhere St');

    expect(result).toEqual({ networks: {} });
  });
});
