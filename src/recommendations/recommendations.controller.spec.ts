import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationsController } from './recommendations.controller';
import { AiService } from '../ai/ai.service';

describe('RecommendationsController', () => {
  let controller: RecommendationsController;
  let aiService: { getRecommendations: jest.Mock };

  beforeEach(async () => {
    aiService = { getRecommendations: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationsController],
      providers: [{ provide: AiService, useValue: aiService }],
    }).compile();

    controller = module.get<RecommendationsController>(RecommendationsController);
  });

  it('returns recommendations array from pv-ai', async () => {
    const recs = [{ id: '1', title: 'Try this place' }];
    aiService.getRecommendations.mockResolvedValue(recs);
    const result = await controller.getRecommendations({ user: { user_id: 'user-1' } });
    expect(result).toEqual(recs);
    expect(aiService.getRecommendations).toHaveBeenCalledWith('user-1');
  });

  it('returns empty array when pv-ai is unreachable', async () => {
    aiService.getRecommendations.mockResolvedValue([]);
    const result = await controller.getRecommendations({ user: { user_id: 'user-1' } });
    expect(result).toEqual([]);
    expect(aiService.getRecommendations).toHaveBeenCalledWith('user-1');
  });
});
