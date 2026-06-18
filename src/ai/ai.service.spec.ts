import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { AiService } from './ai.service';

describe('AiService', () => {
  let service: AiService;
  let httpService: { post: jest.Mock; get: jest.Mock };

  beforeEach(async () => {
    httpService = { post: jest.fn(), get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) => {
              const env: Record<string, string> = {
                FASTAPI_URL: 'http://localhost:5000',
                PJAI_SHARED_SECRET: 'test-secret',
              };
              return env[key] ?? fallback;
            },
          },
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  describe('startChat', () => {
    function mockRelayAndChatStart(chatResponse: unknown) {
      httpService.post
        .mockReturnValueOnce(
          of({ data: { access_token: 'relay-token', token_type: 'bearer', expires_in: 1800 } }),
        )
        .mockReturnValueOnce(of({ data: chatResponse }));
    }

    it('includes previous_messages in the request body when provided', async () => {
      mockRelayAndChatStart({ session_id: 's1', initial_response: 'Hi', detected_language: 'en' });
      const previousMessages = [
        { role: 'user', content: 'old msg' },
        { role: 'assistant', content: 'old reply' },
      ];

      await service.startChat(
        'review-1',
        'transcript',
        'listing-1',
        'en',
        { business_name: 'Biz' },
        'user-1',
        previousMessages,
      );

      const [, body] = httpService.post.mock.calls[1];
      expect(body).toEqual(
        expect.objectContaining({
          review_id: 'review-1',
          transcript: 'transcript',
          listing_id: 'listing-1',
          language: 'en',
          listing_context: { business_name: 'Biz' },
          previous_messages: previousMessages,
        }),
      );
    });

    it('omits previous_messages from the request body when not provided', async () => {
      mockRelayAndChatStart({ session_id: 's2', initial_response: 'Hi', detected_language: 'en' });

      await service.startChat('review-1', 'transcript', 'listing-1', 'en', { business_name: 'Biz' }, 'user-1');

      const [, body] = httpService.post.mock.calls[1];
      expect(body).not.toHaveProperty('previous_messages');
    });
  });
});
