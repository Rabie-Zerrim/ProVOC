import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { ReviewsService } from './reviews.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { POSTING_QUEUE } from './posting.constants';

const USER_ID = 'user-uuid-1';
const OTHER_USER_ID = 'user-uuid-other';
const BUSINESS_ID = 'biz-uuid-1';
const LISTING_ID = 'listing-uuid-1';
const REVIEW_ID = 'review-uuid-1';
const NETWORK_ID = 'net-uuid-1';
const NETWORK_ID_2 = 'net-uuid-2';
const POST_ID = 'post-uuid-1';
const ACCOUNT_ID = 'account-uuid-1';

const mockListing = {
  listing_id: LISTING_ID,
  business_id: BUSINESS_ID,
  network_id: 'net-uuid-1',
  external_listing_id: 'ext-001',
  external_rating: 4.5,
  external_url: null,
  is_active: true,
  last_synced_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const mockReview = {
  review_id: REVIEW_ID,
  user_id: USER_ID,
  business_id: BUSINESS_ID,
  listing_id: LISTING_ID,
  review_text: 'Great place!',
  rating: 5,
  status: 'draft',
  tone: 'polite',
  intent: null,
  language: 'en',
  ai_session_id: null,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  business: { name: 'Test Business' },
  listing: { external_url: null },
};

describe('ReviewsService', () => {
  let service: ReviewsService;
  let mockQueue: { add: jest.Mock };
  let httpService: { post: jest.Mock };
  let aiService: {
    transcribeAudio: jest.Mock;
    startChat: jest.Mock;
    sendMessage: jest.Mock;
    approveDraft: jest.Mock;
    endSession: jest.Mock;
    filterReviewText: jest.Mock;
  };
  let prisma: {
    listing: { findUnique: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
    review: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      groupBy: jest.Mock;
      aggregate: jest.Mock;
    };
    business: { findMany: jest.Mock };
    network: { findUnique: jest.Mock };
    reviewDraft: { findFirst: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock; upsert: jest.Mock };
    reviewChatMessage: { create: jest.Mock; createMany: jest.Mock; findMany: jest.Mock };
    conversationSummary: { create: jest.Mock; findFirst: jest.Mock };
    userPlatformAccount: { findFirst: jest.Mock; create: jest.Mock };
    reviewPlatformPost: {
      create: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    notification: { create: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    mockQueue = { add: jest.fn() };

    httpService = { post: jest.fn() };

    aiService = {
      transcribeAudio: jest.fn(),
      startChat: jest.fn(),
      sendMessage: jest.fn(),
      approveDraft: jest.fn(),
      endSession: jest.fn(),
      filterReviewText: jest.fn(),
    };

    prisma = {
      listing: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
      review: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      },
      business: { findMany: jest.fn() },
      network: { findUnique: jest.fn() },
      reviewDraft: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), upsert: jest.fn() },
      reviewChatMessage: { create: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
      conversationSummary: { create: jest.fn(), findFirst: jest.fn() },
      userPlatformAccount: { findFirst: jest.fn(), create: jest.fn() },
      reviewPlatformPost: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      notification: { create: jest.fn() },
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken(POSTING_QUEUE), useValue: mockQueue },
        { provide: AiService, useValue: aiService },
        { provide: HttpService, useValue: httpService },
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

    service = module.get<ReviewsService>(ReviewsService);
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = {
      listing_id: LISTING_ID,
      review_text: 'Great place!',
      rating: 5,
      tone: 'polite' as const,
      language: 'en',
    };

    it('creates a review draft with status=draft for an existing listing', async () => {
      prisma.listing.findUnique.mockResolvedValue(mockListing);
      prisma.review.create.mockResolvedValue(mockReview);

      const result = await service.create(USER_ID, dto);

      expect(prisma.listing.findUnique).toHaveBeenCalledWith({
        where: { listing_id: LISTING_ID },
      });
      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: USER_ID,
            business_id: BUSINESS_ID,
            listing_id: LISTING_ID,
            status: 'draft',
          }),
        }),
      );
      expect(result).toEqual(mockReview);
    });

    it('throws NotFoundException when listing does not exist', async () => {
      prisma.listing.findUnique.mockResolvedValue(null);

      await expect(service.create(USER_ID, dto)).rejects.toThrow(NotFoundException);
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it('returns existing draft without inserting when a draft for the same listing already exists', async () => {
      prisma.listing.findUnique.mockResolvedValue(mockListing);
      prisma.review.findFirst.mockResolvedValue(mockReview);

      const result = await service.create(USER_ID, dto);

      expect(prisma.review.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: USER_ID,
            listing_id: LISTING_ID,
            status: 'draft',
            deleted_at: null,
          }),
        }),
      );
      expect(prisma.review.create).not.toHaveBeenCalled();
      expect(result).toEqual(mockReview);
    });
  });

  // ── findAll ──────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated reviews scoped to the requesting user', async () => {
      prisma.review.findMany.mockResolvedValue([mockReview]);
      prisma.review.count.mockResolvedValue(1);

      const result = await service.findAll(USER_ID, { page: 1, limit: 10 });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user_id: USER_ID, deleted_at: null }),
          skip: 0,
          take: 10,
          orderBy: { created_at: 'desc' },
        }),
      );
      expect(result.data).toEqual([mockReview]);
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 10, total_pages: 1 });
    });

    it('computes correct skip for page 2', async () => {
      prisma.review.findMany.mockResolvedValue([]);
      prisma.review.count.mockResolvedValue(15);

      await service.findAll(USER_ID, { page: 2, limit: 10 });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('filters by status and paginates correctly (status=draft, page=1, limit=5)', async () => {
      prisma.review.findMany.mockResolvedValue([mockReview]);
      prisma.review.count.mockResolvedValue(1);

      const result = await service.findAll(USER_ID, { status: 'draft', page: 1, limit: 5 });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user_id: USER_ID, status: 'draft' }),
          skip: 0,
          take: 5,
        }),
      );
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 5, total_pages: 1 });
    });

    it('filters by listing_id when provided', async () => {
      prisma.review.findMany.mockResolvedValue([mockReview]);
      prisma.review.count.mockResolvedValue(1);

      await service.findAll(USER_ID, { listing_id: LISTING_ID, page: 1, limit: 10 });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ listing_id: LISTING_ID }),
        }),
      );
    });

    it('filters by business_id when provided', async () => {
      prisma.review.findMany.mockResolvedValue([mockReview]);
      prisma.review.count.mockResolvedValue(1);

      await service.findAll(USER_ID, { business_id: BUSINESS_ID, page: 1, limit: 10 });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ business_id: BUSINESS_ID }),
        }),
      );
    });

    it('applies case-insensitive contains filter when search is provided', async () => {
      prisma.review.findMany.mockResolvedValue([mockReview]);
      prisma.review.count.mockResolvedValue(1);

      await service.findAll(USER_ID, { search: 'great', page: 1, limit: 10 });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            review_text: { contains: 'great', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('sorts by rating ascending when sort_by=rating and sort_order=asc', async () => {
      prisma.review.findMany.mockResolvedValue([mockReview]);
      prisma.review.count.mockResolvedValue(1);

      await service.findAll(USER_ID, { sort_by: 'rating', sort_order: 'asc', page: 1, limit: 10 });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { rating: 'asc' } }),
      );
    });

    it('applies date range filter when date_from and date_to are provided', async () => {
      prisma.review.findMany.mockResolvedValue([]);
      prisma.review.count.mockResolvedValue(0);

      await service.findAll(USER_ID, {
        date_from: '2024-01-01',
        date_to: '2024-12-31',
        page: 1,
        limit: 10,
      });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            created_at: {
              gte: new Date('2024-01-01'),
              lte: new Date('2024-12-31'),
            },
          }),
        }),
      );
    });

    it('caps limit at 50 when a higher value is provided', async () => {
      prisma.review.findMany.mockResolvedValue([]);
      prisma.review.count.mockResolvedValue(0);

      await service.findAll(USER_ID, { page: 1, limit: 100 });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('returns total_pages=0 when there are no results', async () => {
      prisma.review.findMany.mockResolvedValue([]);
      prisma.review.count.mockResolvedValue(0);

      const result = await service.findAll(USER_ID, { page: 1, limit: 10 });

      expect(result.meta.total_pages).toBe(0);
      expect(result.data).toEqual([]);
    });
  });

  // ── getDashboard ─────────────────────────────────────────────────────────────

  describe('getDashboard', () => {
    const BIZ_2 = 'biz-uuid-2';
    const BIZ_3 = 'biz-uuid-3';

    const mockByStatusRaw = [
      { status: 'draft', _count: { status: 2 } },
      { status: 'pending', _count: { status: 1 } },
      { status: 'published', _count: { status: 5 } },
    ];

    const mockRecentReviews = [
      {
        review_id: 'r1',
        rating: 5,
        status: 'published',
        created_at: new Date('2024-03-01'),
        business: { name: 'Alpha Café' },
      },
      {
        review_id: 'r2',
        rating: 4,
        status: 'draft',
        created_at: new Date('2024-02-28'),
        business: { name: 'Beta Bar' },
      },
    ];

    const mockTopBizRaw = [
      { business_id: BUSINESS_ID, _count: { business_id: 5 } },
      { business_id: BIZ_2, _count: { business_id: 3 } },
      { business_id: BIZ_3, _count: { business_id: 1 } },
    ];

    const mockBizNames = [
      { business_id: BUSINESS_ID, name: 'Alpha Café' },
      { business_id: BIZ_2, name: 'Beta Bar' },
      { business_id: BIZ_3, name: 'Gamma Grill' },
    ];

    function setupDashboard({
      total = 8,
      byStatus = mockByStatusRaw,
      recent = mockRecentReviews,
      topBiz = mockTopBizRaw,
      bizNames = mockBizNames,
    } = {}) {
      prisma.review.count.mockResolvedValue(total);
      prisma.review.groupBy
        .mockResolvedValueOnce(byStatus)
        .mockResolvedValueOnce(topBiz);
      prisma.review.findMany.mockResolvedValue(recent);
      prisma.business.findMany.mockResolvedValue(bizNames);
    }

    it('returns total_reviews from the review count query', async () => {
      setupDashboard({ total: 8 });

      const result = await service.getDashboard(USER_ID);

      expect(result.total_reviews).toBe(8);
    });

    it('returns correct counts per status and 0 for statuses with no reviews', async () => {
      setupDashboard();

      const result = await service.getDashboard(USER_ID);

      expect(result.by_status).toEqual({
        draft: 2,
        pending: 1,
        published: 5,
        posted: 0,
      });
    });

    it('maps recent_reviews to flat shape with business_name included', async () => {
      setupDashboard();

      const result = await service.getDashboard(USER_ID);

      expect(result.recent_reviews[0]).toEqual({
        review_id: 'r1',
        business_name: 'Alpha Café',
        rating: 5,
        status: 'published',
        created_at: new Date('2024-03-01'),
      });
      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
          orderBy: { created_at: 'desc' },
        }),
      );
    });

    it('returns top 3 businesses ranked by review count with resolved names', async () => {
      setupDashboard();

      const result = await service.getDashboard(USER_ID);

      expect(result.top_businesses).toHaveLength(3);
      expect(result.top_businesses[0]).toEqual({
        business_id: BUSINESS_ID,
        name: 'Alpha Café',
        review_count: 5,
      });
      expect(result.top_businesses[1]).toEqual({
        business_id: BIZ_2,
        name: 'Beta Bar',
        review_count: 3,
      });
    });
  });

  // ── getStats ─────────────────────────────────────────────────────────────────

  describe('getStats', () => {
    function setupStats({
      avg = 4.167,
      thisMonth = 5,
      lastMonth = 8,
      languages = [
        { language: 'fr', _count: { language: 12 } },
        { language: 'en', _count: { language: 5 } },
      ],
      category = [{ business_type: 'restaurant' }],
    } = {}) {
      prisma.review.aggregate.mockResolvedValue({ _avg: { rating: avg } });
      prisma.review.count
        .mockResolvedValueOnce(thisMonth)
        .mockResolvedValueOnce(lastMonth);
      prisma.review.groupBy.mockResolvedValue(languages);
      prisma.$queryRaw.mockResolvedValue(category);
    }

    it('returns average_rating rounded to 2 decimal places', async () => {
      setupStats({ avg: 4.167 });

      const result = await service.getStats(USER_ID);

      expect(result.average_rating).toBe(4.17);
    });

    it('returns null for average_rating when the user has no reviews', async () => {
      setupStats({ avg: null as unknown as number });

      const result = await service.getStats(USER_ID);

      expect(result.average_rating).toBeNull();
    });

    it('returns this_month and last_month review counts', async () => {
      setupStats({ thisMonth: 5, lastMonth: 8 });

      const result = await service.getStats(USER_ID);

      expect(result.this_month).toBe(5);
      expect(result.last_month).toBe(8);
    });

    it('returns languages as a count-per-code object', async () => {
      setupStats({
        languages: [
          { language: 'fr', _count: { language: 12 } },
          { language: 'en', _count: { language: 5 } },
        ],
      });

      const result = await service.getStats(USER_ID);

      expect(result.languages).toEqual({ fr: 12, en: 5 });
    });

    it('skips null language entries in the languages map', async () => {
      setupStats({
        languages: [
          { language: 'fr', _count: { language: 12 } },
          { language: null, _count: { language: 3 } },
        ],
      });

      const result = await service.getStats(USER_ID);

      expect(result.languages).toEqual({ fr: 12 });
    });

    it('returns most_reviewed_category from the raw query result', async () => {
      setupStats({ category: [{ business_type: 'restaurant' }] });

      const result = await service.getStats(USER_ID);

      expect(result.most_reviewed_category).toBe('restaurant');
    });

    it('returns null for most_reviewed_category when no business type data exists', async () => {
      setupStats({ category: [] });

      const result = await service.getStats(USER_ID);

      expect(result.most_reviewed_category).toBeNull();
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('throws NotFoundException when review does not exist', async () => {
      prisma.review.findFirst.mockResolvedValue(null);

      await expect(service.findOne(USER_ID, 'bad-id')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when review belongs to another user', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, user_id: OTHER_USER_ID });

      await expect(service.findOne(USER_ID, REVIEW_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── update ───────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates review_text without touching category_ratings when not provided', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.review.update.mockResolvedValue({ ...mockReview, review_text: 'Updated text' });

      const result = await service.update(USER_ID, REVIEW_ID, { review_text: 'Updated text' });

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { review_id: REVIEW_ID },
          data: { review_text: 'Updated text' },
        }),
      );
      expect(result.review_text).toBe('Updated text');
    });

    it('persists category_ratings when all values are numbers between 1 and 5', async () => {
      const categoryRatings = { Food: 4, Service: 5, Atmosphere: 3 };
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.review.update.mockResolvedValue({ ...mockReview, category_ratings: categoryRatings });

      const result = await service.update(USER_ID, REVIEW_ID, { category_ratings: categoryRatings });

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ category_ratings: categoryRatings }),
        }),
      );
      expect(result.category_ratings).toEqual(categoryRatings);
    });

    it('persists selected_networks when provided', async () => {
      const selectedNetworks = ['google', 'yelp'];
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.review.update.mockResolvedValue({ ...mockReview, selected_networks: selectedNetworks });

      const result = await service.update(USER_ID, REVIEW_ID, { selected_networks: selectedNetworks });

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ selected_networks: selectedNetworks }),
        }),
      );
      expect(result.selected_networks).toEqual(selectedNetworks);
    });

    it('does not touch selected_networks when not provided', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.review.update.mockResolvedValue({ ...mockReview, review_text: 'Updated text' });

      await service.update(USER_ID, REVIEW_ID, { review_text: 'Updated text' });

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { review_text: 'Updated text' },
        }),
      );
    });

    it('throws BadRequestException when a category value is above 5, without writing to the DB', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);

      await expect(
        service.update(USER_ID, REVIEW_ID, { category_ratings: { Food: 6 } }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.review.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when a category value is not a number, without writing to the DB', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);

      await expect(
        service.update(USER_ID, REVIEW_ID, { category_ratings: { Food: 'great' as any } }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.review.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the review belongs to another user', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, user_id: OTHER_USER_ID });

      await expect(
        service.update(USER_ID, REVIEW_ID, { category_ratings: { Food: 4 } }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.review.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the review does not exist', async () => {
      prisma.review.findFirst.mockResolvedValue(null);

      await expect(
        service.update(USER_ID, REVIEW_ID, { review_text: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('soft-deletes by setting deleted_at', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.review.update.mockResolvedValue({ ...mockReview, deleted_at: new Date() });

      const result = await service.remove(USER_ID, REVIEW_ID);

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { review_id: REVIEW_ID },
          data: expect.objectContaining({ deleted_at: expect.any(Date) }),
        }),
      );
      expect(result).toEqual({ message: 'Review deleted successfully' });
    });

    it("throws ForbiddenException when trying to delete another user's review", async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, user_id: OTHER_USER_ID });

      await expect(service.remove(USER_ID, REVIEW_ID)).rejects.toThrow(ForbiddenException);
      expect(prisma.review.update).not.toHaveBeenCalled();
    });
  });

  // ── publish ──────────────────────────────────────────────────────────────────

  describe('publish', () => {
    const mockNetwork = {
      network_id: NETWORK_ID,
      name: 'Google',
      preferences: { supports_api_posting: true },
    };
    const mockNetwork2 = {
      network_id: NETWORK_ID_2,
      name: 'TripAdvisor',
      preferences: { supports_api_posting: true },
    };
    const mockDraft = {
      draft_id: 'draft-uuid-1',
      review_id: REVIEW_ID,
      network_id: NETWORK_ID,
      draft_text: 'Great place!',
      is_selected: true,
    };
    const mockAccount = { account_id: ACCOUNT_ID, user_id: USER_ID, network_id: NETWORK_ID };
    const mockPost = { post_id: POST_ID, review_id: REVIEW_ID, network_id: NETWORK_ID };

    it('queues jobs for 2 platforms and returns both in queued[]', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.network.findUnique
        .mockResolvedValueOnce(mockNetwork)
        .mockResolvedValueOnce(mockNetwork2);
      prisma.reviewDraft.findFirst
        .mockResolvedValueOnce(mockDraft)
        .mockResolvedValueOnce({ ...mockDraft, network_id: NETWORK_ID_2 });
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create
        .mockResolvedValueOnce(mockPost)
        .mockResolvedValueOnce({ ...mockPost, post_id: 'post-uuid-2' });
      mockQueue.add.mockResolvedValue({});

      const result = await service.publish(USER_ID, REVIEW_ID, {
        platform_ids: [NETWORK_ID, NETWORK_ID_2],
      });

      expect(mockQueue.add).toHaveBeenCalledTimes(2);
      expect(result.queued).toEqual(['Google', 'TripAdvisor']);
      expect(result.skipped).toHaveLength(0);
    });

    it('falls back to review_text when no selected draft exists', async () => {
      const mockPost = { post_id: POST_ID, review_id: REVIEW_ID, network_id: NETWORK_ID };
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.network.findUnique.mockResolvedValue(mockNetwork);
      prisma.reviewDraft.findFirst.mockResolvedValue(null);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);
      mockQueue.add.mockResolvedValue({});

      const result = await service.publish(USER_ID, REVIEW_ID, {
        platform_ids: [NETWORK_ID],
      });

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(result.queued).toEqual(['Google']);
      expect(result.skipped).toHaveLength(0);
    });

    it('skips a platform when no draft and no review_text', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, review_text: '' });
      prisma.network.findUnique.mockResolvedValue(mockNetwork);
      prisma.reviewDraft.findFirst.mockResolvedValue(null);

      const result = await service.publish(USER_ID, REVIEW_ID, {
        platform_ids: [NETWORK_ID],
      });

      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(result.skipped).toEqual([
        { network: 'Google', reason: 'No selected draft for this platform' },
      ]);
    });

    it('skips a platform when supports_api_posting is false', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.network.findUnique.mockResolvedValue({
        ...mockNetwork,
        preferences: { supports_api_posting: false },
      });
      prisma.reviewDraft.findFirst.mockResolvedValue(mockDraft);

      const result = await service.publish(USER_ID, REVIEW_ID, {
        platform_ids: [NETWORK_ID],
      });

      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(result.skipped).toEqual([
        { network: 'Google', reason: 'Platform does not support API posting' },
      ]);
    });

    it('throws ForbiddenException when the review belongs to another user', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, user_id: OTHER_USER_ID });

      await expect(
        service.publish(USER_ID, REVIEW_ID, { platform_ids: [NETWORK_ID] }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  // ── retryFailed ──────────────────────────────────────────────────────────────

  describe('retryFailed', () => {
    const mockFailedPost = {
      post_id: POST_ID,
      review_id: REVIEW_ID,
      network_id: NETWORK_ID,
      status: 'failed',
      platform_specific_text: 'Great place!',
      listing_id: LISTING_ID,
      network: { name: 'Google' },
    };

    it('re-queues failed posts and increments retry_count', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.reviewPlatformPost.findMany.mockResolvedValue([mockFailedPost]);
      prisma.reviewDraft.findFirst.mockResolvedValue({
        draft_text: 'Great place!',
        is_selected: true,
      });
      prisma.reviewPlatformPost.update.mockResolvedValue({});
      mockQueue.add.mockResolvedValue({});

      const result = await service.retryFailed(USER_ID, REVIEW_ID);

      expect(prisma.reviewPlatformPost.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { post_id: POST_ID },
          data: expect.objectContaining({ retry_count: { increment: 1 }, status: 'queued' }),
        }),
      );
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ retried: 1 });
    });

    it('throws BadRequestException when no failed posts exist', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.reviewPlatformPost.findMany.mockResolvedValue([]);

      await expect(service.retryFailed(USER_ID, REVIEW_ID)).rejects.toThrow(BadRequestException);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the review belongs to another user', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, user_id: OTHER_USER_ID });

      await expect(service.retryFailed(USER_ID, REVIEW_ID)).rejects.toThrow(ForbiddenException);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  // ── getPosts ─────────────────────────────────────────────────────────────────

  describe('getPosts', () => {
    it('throws ForbiddenException when the review belongs to another user', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, user_id: OTHER_USER_ID });

      await expect(service.getPosts(USER_ID, REVIEW_ID)).rejects.toThrow(ForbiddenException);
      expect(prisma.reviewPlatformPost.findMany).not.toHaveBeenCalled();
    });

    it('returns the correct shape for each platform post', async () => {
      const postedAt = new Date('2024-06-01T12:00:00Z');
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.reviewPlatformPost.findMany.mockResolvedValue([
        {
          post_id: POST_ID,
          network: { name: 'Google' },
          status: 'simulated',
          posted_at: postedAt,
          external_review_id: 'SIMULATED-abc123',
          retry_count: 0,
          error_message: null,
        },
      ]);

      const result = await service.getPosts(USER_ID, REVIEW_ID);

      expect(result).toEqual([
        {
          platform: 'Google',
          status: 'simulated',
          posted_at: postedAt,
          external_review_id: 'SIMULATED-abc123',
          retry_count: 0,
          error_message: null,
        },
      ]);
    });
  });

  // ── transcribeAudio ───────────────────────────────────────────────────────────

  describe('transcribeAudio', () => {
    const audioBuffer = Buffer.from('fake-audio');
    const language = 'fr';
    const mimetype = 'audio/webm';

    it('calls AiService.transcribeAudio and updates review_text and language', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      aiService.transcribeAudio.mockResolvedValue({ transcript: 'Great place!', detected_language: 'en' });
      prisma.review.update.mockResolvedValue({});

      const result = await service.transcribeAudio(USER_ID, REVIEW_ID, audioBuffer, language, mimetype);

      expect(aiService.transcribeAudio).toHaveBeenCalledWith(audioBuffer, language, mimetype, USER_ID);
      expect(prisma.review.update).toHaveBeenCalledWith({
        where: { review_id: REVIEW_ID },
        data: { review_text: 'Great place!', language: 'en' },
      });
      expect(result).toEqual({ transcript: 'Great place!', detected_language: 'en', review_id: REVIEW_ID });
    });

    it('throws ForbiddenException when the review belongs to another user', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, user_id: OTHER_USER_ID });

      await expect(
        service.transcribeAudio(USER_ID, REVIEW_ID, audioBuffer, language, mimetype),
      ).rejects.toThrow(ForbiddenException);
      expect(aiService.transcribeAudio).not.toHaveBeenCalled();
    });
  });

  // ── startChat ─────────────────────────────────────────────────────────────────

  describe('startChat', () => {
    const mockListingWithNetwork = {
      listing_id: LISTING_ID,
      business_id: BUSINESS_ID,
      is_active: true,
      network: {
        name: 'Google',
        preferences: { max_chars_post: 300, supports_api_posting: true },
      },
    };

    it('builds correct listingContext and stores session_id on the review', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, business: { name: 'Test Business' } });
      prisma.listing.findMany.mockResolvedValue([mockListingWithNetwork]);
      prisma.conversationSummary.findFirst.mockResolvedValue(null);
      aiService.startChat.mockResolvedValue({
        session_id: 'session-123',
        initial_response: 'Hello!',
        detected_language: 'en',
      });
      prisma.review.update.mockResolvedValue({});

      const result = await service.startChat(USER_ID, REVIEW_ID);

      expect(aiService.startChat).toHaveBeenCalledWith(
        REVIEW_ID,
        `The current review text is: "${mockReview.review_text}".\nThe user wants to continue refining it. Ask them what they would like to change.`,
        LISTING_ID,
        mockReview.language,
        expect.objectContaining({
          business_name: 'Test Business',
          networks: expect.arrayContaining([
            expect.objectContaining({ name: 'Google', max_chars: 300, supports_api_posting: true }),
          ]),
        }),
        USER_ID,
        undefined,
        'start',
        null,
      );
      expect(prisma.review.update).toHaveBeenCalledWith({
        where: { review_id: REVIEW_ID },
        data: { ai_session_id: 'session-123' },
      });
      expect(prisma.reviewChatMessage.createMany).not.toHaveBeenCalled();
      expect(result).toMatchObject({ session_id: 'session-123', review_id: REVIEW_ID });
    });

    it('sends empty transcript when review has no text', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, review_text: '', business: { name: 'Test Business' } });
      prisma.listing.findMany.mockResolvedValue([mockListingWithNetwork]);
      aiService.startChat.mockResolvedValue({
        session_id: 'session-456',
        initial_response: 'Hello!',
        detected_language: 'en',
      });
      prisma.review.update.mockResolvedValue({});

      await service.startChat(USER_ID, REVIEW_ID);

      expect(aiService.startChat).toHaveBeenCalledWith(
        REVIEW_ID,
        '',
        LISTING_ID,
        mockReview.language,
        expect.objectContaining({ business_name: 'Test Business' }),
        USER_ID,
        undefined,
        'start',
        null,
      );
      expect(prisma.conversationSummary.findFirst).not.toHaveBeenCalled();
      expect(prisma.reviewChatMessage.create).not.toHaveBeenCalled();
      expect(prisma.reviewChatMessage.createMany).not.toHaveBeenCalled();
    });

    it('queries conversationSummary table and passes the latest summary to aiService.startChat', async () => {
      const summary = 'User loved the food, had issues with service.';
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, business: { name: 'Test Business' } });
      prisma.listing.findMany.mockResolvedValue([mockListingWithNetwork]);
      prisma.conversationSummary.findFirst.mockResolvedValue({ summary, review_id: REVIEW_ID, created_at: new Date() });
      aiService.startChat.mockResolvedValue({
        session_id: 'session-789',
        initial_response: 'Hello!',
        detected_language: 'en',
      });
      prisma.review.update.mockResolvedValue({});

      await service.startChat(USER_ID, REVIEW_ID);

      expect(prisma.conversationSummary.findFirst).toHaveBeenCalledWith({
        where: { review_id: REVIEW_ID },
        orderBy: { created_at: 'desc' },
      });
      expect(aiService.startChat).toHaveBeenCalledWith(
        REVIEW_ID,
        `The current review text is: "${mockReview.review_text}".\nThe user wants to continue refining it. Ask them what they would like to change.`,
        LISTING_ID,
        mockReview.language,
        expect.objectContaining({ business_name: 'Test Business' }),
        USER_ID,
        undefined,
        'start',
        summary,
      );
    });

    it('passes null conversation_summary to aiService when no summary record exists', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, business: { name: 'Test Business' } });
      prisma.listing.findMany.mockResolvedValue([mockListingWithNetwork]);
      prisma.conversationSummary.findFirst.mockResolvedValue(null);
      aiService.startChat.mockResolvedValue({
        session_id: 'session-000',
        initial_response: 'Hello!',
        detected_language: 'en',
      });
      prisma.review.update.mockResolvedValue({});

      await service.startChat(USER_ID, REVIEW_ID);

      expect(aiService.startChat).toHaveBeenCalledWith(
        REVIEW_ID,
        `The current review text is: "${mockReview.review_text}".\nThe user wants to continue refining it. Ask them what they would like to change.`,
        LISTING_ID,
        mockReview.language,
        expect.objectContaining({ business_name: 'Test Business' }),
        USER_ID,
        undefined,
        'start',
        null,
      );
    });

    it('does not query conversationSummary table when review_text is empty', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, review_text: '', business: { name: 'Test Business' } });
      prisma.listing.findMany.mockResolvedValue([mockListingWithNetwork]);
      aiService.startChat.mockResolvedValue({
        session_id: 'session-empty',
        initial_response: 'Hello!',
        detected_language: 'en',
      });
      prisma.review.update.mockResolvedValue({});

      await service.startChat(USER_ID, REVIEW_ID);

      expect(prisma.conversationSummary.findFirst).not.toHaveBeenCalled();
    });

    it('forwards body.previous_messages through to AiService.startChat for regenerate/rephrase', async () => {
      const previousMessages = [
        { role: 'user', content: 'Make it more formal' },
        { role: 'assistant', content: 'Here is a more formal version...' },
      ];
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, business: { name: 'Test Business' } });
      prisma.listing.findMany.mockResolvedValue([mockListingWithNetwork]);
      prisma.conversationSummary.findFirst.mockResolvedValue(null);
      aiService.startChat.mockResolvedValue({
        session_id: 'session-regen',
        initial_response: 'Hello!',
        detected_language: 'en',
      });
      prisma.review.update.mockResolvedValue({});

      await service.startChat(USER_ID, REVIEW_ID, { previous_messages: previousMessages } as any);

      expect(aiService.startChat).toHaveBeenCalledWith(
        REVIEW_ID,
        `The current review text is: "${mockReview.review_text}".\nThe user wants to continue refining it. Ask them what they would like to change.`,
        LISTING_ID,
        mockReview.language,
        expect.objectContaining({ business_name: 'Test Business' }),
        USER_ID,
        previousMessages,
        'regenerate',
        null,
      );
    });

    it('forwards purpose:"regenerate" to AiService when body contains previous_messages', async () => {
      const previousMessages = [{ role: 'user', content: 'original turn' }];
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, business: { name: 'Test Business' } });
      prisma.listing.findMany.mockResolvedValue([mockListingWithNetwork]);
      prisma.conversationSummary.findFirst.mockResolvedValue(null);
      aiService.startChat.mockResolvedValue({ session_id: 'sid', initial_response: 'ok', detected_language: 'en' });
      prisma.review.update.mockResolvedValue({});

      await service.startChat(USER_ID, REVIEW_ID, { previous_messages: previousMessages } as any);

      expect(aiService.startChat).toHaveBeenCalledWith(
        REVIEW_ID,
        expect.any(String),
        LISTING_ID,
        mockReview.language,
        expect.objectContaining({ business_name: 'Test Business' }),
        USER_ID,
        previousMessages,
        'regenerate',
        null,
      );
    });

    it('throws ForbiddenException when the review belongs to another user', async () => {
      prisma.review.findFirst.mockResolvedValue({
        ...mockReview,
        user_id: OTHER_USER_ID,
        business: { name: 'Test Business' },
      });

      await expect(service.startChat(USER_ID, REVIEW_ID)).rejects.toThrow(ForbiddenException);
      expect(aiService.startChat).not.toHaveBeenCalled();
    });
  });

  // ── sendMessage ───────────────────────────────────────────────────────────────

  describe('sendMessage', () => {
    it('throws BadRequestException when ai_session_id is null', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, ai_session_id: null });

      await expect(service.sendMessage(USER_ID, REVIEW_ID, 'Hello')).rejects.toThrow(BadRequestException);
      expect(aiService.sendMessage).not.toHaveBeenCalled();
    });

    it('calls AiService.sendMessage with the stored session_id', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, ai_session_id: 'session-123' });
      aiService.sendMessage.mockResolvedValue({ response: 'Sure!', session_id: 'session-123' });

      const result = await service.sendMessage(USER_ID, REVIEW_ID, 'Make it shorter');

      expect(aiService.sendMessage).toHaveBeenCalledWith('session-123', 'Make it shorter', USER_ID, 'message');
      expect(result).toEqual({ response: 'Sure!', session_id: 'session-123' });
    });

    it('skips DB write when message is a rephrase instruction', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, ai_session_id: 'session-123' });
      aiService.sendMessage.mockResolvedValue({ response: 'Rephrased!', session_id: 'session-123' });

      const result = await service.sendMessage(
        USER_ID,
        REVIEW_ID,
        'Please rewrite this review with different wording',
      );

      expect(aiService.sendMessage).toHaveBeenCalledWith(
        'session-123',
        'Please rewrite this review with different wording',
        USER_ID,
        'rephrase',
      );
      expect(prisma.reviewChatMessage.createMany).not.toHaveBeenCalled();
      expect(result).toEqual({ response: 'Rephrased!', session_id: 'session-123' });
    });

    it('forwards purpose:"rephrase" to AiService when message is a rephrase instruction', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, ai_session_id: 'session-123' });
      aiService.sendMessage.mockResolvedValue({ response: 'Rephrased!', session_id: 'session-123' });

      await service.sendMessage(USER_ID, REVIEW_ID, 'Please rewrite this review in a friendlier tone');

      expect(aiService.sendMessage).toHaveBeenCalledWith(
        'session-123',
        'Please rewrite this review in a friendlier tone',
        USER_ID,
        'rephrase',
      );
    });
  });

  // ── approveDraft ──────────────────────────────────────────────────────────────

  describe('approveDraft', () => {
    const mockApproveResult = {
      review_text: 'Excellent place!',
      rating: 5,
      sentiment: 'positive',
      tone: 'friendly',
      key_points: ['great service'],
      conversation_summary: null,
    };

    it('updates review fields, selected drafts, ends session and clears ai_session_id', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, ai_session_id: 'session-123' });
      aiService.approveDraft.mockResolvedValue(mockApproveResult);
      prisma.review.update.mockResolvedValue({});
      prisma.reviewDraft.findFirst.mockResolvedValue(null);
      prisma.reviewDraft.upsert.mockResolvedValue({});
      prisma.reviewDraft.updateMany.mockResolvedValue({ count: 1 });
      aiService.endSession.mockResolvedValue({ success: true });

      const result = await service.approveDraft(USER_ID, REVIEW_ID);

      expect(prisma.review.update).toHaveBeenCalledWith({
        where: { review_id: REVIEW_ID },
        data: {
          review_text: 'Excellent place!',
          rating: 5,
          tone: 'friendly',
          status: 'pending',
          ai_session_id: null,
          conversation_summary: null,
        },
      });
      expect(prisma.reviewDraft.updateMany).toHaveBeenCalledWith({
        where: { review_id: REVIEW_ID, is_selected: true },
        data: { draft_text: 'Excellent place!' },
      });
      expect(aiService.endSession).toHaveBeenCalledWith('session-123', USER_ID);
      expect(result).toMatchObject({ ...mockApproveResult, review_id: REVIEW_ID });
    });

    it('saves conversation_summary to review when approve returns it', async () => {
      const summary = 'The user had a great experience with the staff.';
      const summaryResult = { ...mockApproveResult, conversation_summary: summary };
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, ai_session_id: 'session-123' });
      aiService.approveDraft.mockResolvedValue(summaryResult);
      prisma.review.update.mockResolvedValue({});
      prisma.reviewDraft.findFirst.mockResolvedValue(null);
      prisma.reviewDraft.upsert.mockResolvedValue({});
      prisma.reviewDraft.updateMany.mockResolvedValue({ count: 1 });
      aiService.endSession.mockResolvedValue({ success: true });
      prisma.conversationSummary.create.mockResolvedValue({});

      await service.approveDraft(USER_ID, REVIEW_ID);

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ conversation_summary: summary }),
        }),
      );
      expect(prisma.conversationSummary.create).toHaveBeenCalledWith({
        data: { review_id: REVIEW_ID, summary },
      });
    });

    it('creates a ConversationSummary row in conversation_summaries when approve returns a non-null summary', async () => {
      const summary = 'Loved the ambiance, will return.';
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, ai_session_id: 'session-123' });
      aiService.approveDraft.mockResolvedValue({ ...mockApproveResult, conversation_summary: summary });
      prisma.review.update.mockResolvedValue({});
      prisma.reviewDraft.findFirst.mockResolvedValue(null);
      prisma.reviewDraft.upsert.mockResolvedValue({});
      prisma.reviewDraft.updateMany.mockResolvedValue({ count: 1 });
      aiService.endSession.mockResolvedValue({ success: true });
      prisma.conversationSummary.create.mockResolvedValue({});

      await service.approveDraft(USER_ID, REVIEW_ID);

      expect(prisma.conversationSummary.create).toHaveBeenCalledWith({
        data: { review_id: REVIEW_ID, summary },
      });
    });

    it('does not create a ConversationSummary row when summary is null', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, ai_session_id: 'session-123' });
      aiService.approveDraft.mockResolvedValue({ ...mockApproveResult, conversation_summary: null });
      prisma.review.update.mockResolvedValue({});
      prisma.reviewDraft.findFirst.mockResolvedValue(null);
      prisma.reviewDraft.upsert.mockResolvedValue({});
      prisma.reviewDraft.updateMany.mockResolvedValue({ count: 1 });
      aiService.endSession.mockResolvedValue({ success: true });

      await service.approveDraft(USER_ID, REVIEW_ID);

      expect(prisma.conversationSummary.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the review belongs to another user', async () => {
      prisma.review.findFirst.mockResolvedValue({
        ...mockReview,
        user_id: OTHER_USER_ID,
        ai_session_id: 'session-123',
      });

      await expect(service.approveDraft(USER_ID, REVIEW_ID)).rejects.toThrow(ForbiddenException);
      expect(aiService.approveDraft).not.toHaveBeenCalled();
    });
  });

  // ── getDrafts ─────────────────────────────────────────────────────────────────

  describe('getDrafts', () => {
    it('returns correct shape with network name', async () => {
      const createdAt = new Date('2024-06-01T00:00:00Z');
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.reviewDraft.findMany.mockResolvedValue([
        {
          draft_id: 'draft-uuid-1',
          review_id: REVIEW_ID,
          network_id: NETWORK_ID,
          version: 1,
          draft_text: 'Great place!',
          compliance_check: true,
          is_selected: true,
          created_at: createdAt,
          network: { name: 'Google' },
        },
      ]);

      const result = await service.getDrafts(USER_ID, REVIEW_ID);

      expect(result).toEqual([
        {
          draft_id: 'draft-uuid-1',
          network: 'Google',
          draft_text: 'Great place!',
          version: 1,
          compliance_check: true,
          is_selected: true,
          created_at: createdAt,
        },
      ]);
    });

    it('returns null for network when draft has no network', async () => {
      const createdAt = new Date();
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.reviewDraft.findMany.mockResolvedValue([
        {
          draft_id: 'draft-uuid-2',
          review_id: REVIEW_ID,
          network_id: null,
          version: 1,
          draft_text: 'Generic draft',
          compliance_check: true,
          is_selected: false,
          created_at: createdAt,
          network: null,
        },
      ]);

      const result = await service.getDrafts(USER_ID, REVIEW_ID);

      expect(result[0].network).toBeNull();
    });
  });

  // ── getChatHistory ────────────────────────────────────────────────────────────

  describe('getChatHistory', () => {
    const mockMessages = [
      {
        message_id: 'msg-uuid-1',
        review_id: REVIEW_ID,
        role: 'assistant',
        content: 'Hello!',
        created_at: new Date('2024-06-01T10:00:00Z'),
      },
      {
        message_id: 'msg-uuid-2',
        review_id: REVIEW_ID,
        role: 'user',
        content: 'Make it shorter',
        created_at: new Date('2024-06-01T10:01:00Z'),
      },
      {
        message_id: 'msg-uuid-3',
        review_id: REVIEW_ID,
        role: 'assistant',
        content: 'Sure, here is a shorter version.',
        created_at: new Date('2024-06-01T10:02:00Z'),
      },
    ];

    it('returns messages ordered by created_at ascending', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.reviewChatMessage.findMany.mockResolvedValue(mockMessages);

      const result = await service.getChatHistory(USER_ID, REVIEW_ID);

      expect(prisma.reviewChatMessage.findMany).toHaveBeenCalledWith({
        where: { review_id: REVIEW_ID },
        orderBy: { created_at: 'asc' },
      });
      expect(result).toEqual(mockMessages);
    });

    it('throws ForbiddenException when the review belongs to another user', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, user_id: OTHER_USER_ID });

      await expect(service.getChatHistory(USER_ID, REVIEW_ID)).rejects.toThrow(ForbiddenException);
      expect(prisma.reviewChatMessage.findMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the review does not exist', async () => {
      prisma.review.findFirst.mockResolvedValue(null);

      await expect(service.getChatHistory(USER_ID, REVIEW_ID)).rejects.toThrow(NotFoundException);
      expect(prisma.reviewChatMessage.findMany).not.toHaveBeenCalled();
    });
  });

  // ── getPublishLink ────────────────────────────────────────────────────────────

  describe('getPublishLink', () => {
    const mockAccount = { account_id: ACCOUNT_ID, user_id: USER_ID, network_id: NETWORK_ID };
    const mockPost = { post_id: POST_ID, review_id: REVIEW_ID, network_id: NETWORK_ID, status: 'clipboard_opened' };

    function makeListingWithNetwork(
      networkName: string,
      externalListingId: string,
      externalUrl: string | null = null,
      zembraExternalId: string | null = null,
    ) {
      return {
        listing_id: LISTING_ID,
        business_id: BUSINESS_ID,
        network_id: NETWORK_ID,
        external_listing_id: externalListingId,
        zembra_external_id: zembraExternalId,
        external_url: externalUrl,
        is_active: true,
        network: {
          network_id: NETWORK_ID,
          name: networkName,
          preferences: { post_auth_type: 'clipboard_deeplink' },
        },
      };
    }

    it('constructs the correct Google write-review URL', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork('Google', 'ChIJrTLr-GyuEmsRBfy61i59si0'),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(result.url).toBe(
        'https://search.google.com/local/writereview?placeid=ChIJrTLr-GyuEmsRBfy61i59si0',
      );
      expect(result.platform_name).toBe('Google');
      expect(result.review_text).toBe(mockReview.review_text);
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('constructs the correct Yelp write-review URL', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork('Yelp', 'best-biz-san-francisco'),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(result.url).toBe('https://www.yelp.com/writeareview/biz/best-biz-san-francisco');
      expect(result.platform_name).toBe('Yelp');
    });

    it('Yelp + zembra_external_id present → builds writeareview URL from the real Yelp ID, ignoring external_url', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork(
          'Yelp',
          'zembra-yelp-biz-uuid-1',
          'https://www.yelp.com/biz/shake-shack-madison-square-park-new-york-3',
          'FEVQpbOPOwAPNIgO7D3xxw',
        ),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(result.url).toBe('https://www.yelp.com/writeareview/biz/FEVQpbOPOwAPNIgO7D3xxw');
      expect(result.platform_name).toBe('Yelp');
      expect(prisma.reviewPlatformPost.create).toHaveBeenCalled();
    });

    it('Yelp + zembra- id with usable yelp.com external_url → uses external_url directly', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork(
          'Yelp',
          'zembra-yelp-biz-uuid-1',
          'https://www.yelp.com/biz/shake-shack-madison-square-park-new-york-3',
        ),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(result.url).toBe(
        'https://www.yelp.com/biz/shake-shack-madison-square-park-new-york-3',
      );
      expect(result.url).not.toBe(
        'https://www.yelp.com/writeareview/biz/zembra-yelp-biz-uuid-1',
      );
      expect(result.platform_name).toBe('Yelp');
      expect(prisma.reviewPlatformPost.create).toHaveBeenCalled();
    });

    it('Yelp + real (non-synthetic) external_listing_id → unchanged existing behavior even with external_url present', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork(
          'Yelp',
          'best-biz-san-francisco',
          'https://www.yelp.com/biz/some-other-page',
        ),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(result.url).toBe('https://www.yelp.com/writeareview/biz/best-biz-san-francisco');
      expect(result.platform_name).toBe('Yelp');
    });

    it('Yelp + synthetic zembra-yelp-<uuid> id, no zembra_external_id, no external_url → returns url: null (not a broken writeareview link)', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork('Yelp', 'zembra-yelp-biz-uuid-1'),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(result.url).toBeNull();
      expect(result.url).not.toBe(
        'https://www.yelp.com/writeareview/biz/zembra-yelp-biz-uuid-1',
      );
      expect(result.platform_name).toBe('Yelp');
      expect(prisma.reviewPlatformPost.create).toHaveBeenCalled();
    });

    it('parses the domain from external_url and constructs the Trustpilot evaluate URL', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork('Trustpilot', 'tp-ext-001', 'https://www.trustpilot.com/review/example.com'),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(result.url).toBe('https://www.trustpilot.com/evaluate/example.com');
      expect(result.platform_name).toBe('Trustpilot');
    });

    it('constructs the correct Facebook search URL using the business name', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork('Facebook', 'facebook-ext-001'),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(result.url).toBe(
        `https://www.facebook.com/search/top?q=${encodeURIComponent('Test Business')}`,
      );
      expect(result.platform_name).toBe('Facebook');
    });

    it('Google + zembra- id with usable external_url → derives link from external_url, no Places API call', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork('Google', 'zembra-001', 'https://maps.google.com/?cid=12345'),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(result.url).toBe('https://maps.google.com/?cid=12345');
      expect(result.url).not.toBe(
        'https://search.google.com/local/writereview?placeid=zembra-001',
      );
      expect(result.platform_name).toBe('Google');
      expect(httpService.post).not.toHaveBeenCalled();
      expect(prisma.reviewPlatformPost.create).toHaveBeenCalled();
    });

    it('Google + zembra- id with no external_url → falls through to Places API lookup', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork('Google', 'zembra-001'),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);
      httpService.post.mockReturnValue(
        of({ data: { places: [{ id: 'ChIJ_real_place_id' }] } }),
      );

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.stringContaining('https://places.googleapis.com/v1/places:searchText'),
        expect.objectContaining({ textQuery: 'Test Business' }),
      );
      expect(result.url).toBe(
        'https://search.google.com/local/writereview?placeid=ChIJ_real_place_id',
      );
      expect(result.url).not.toBe(
        'https://search.google.com/local/writereview?placeid=zembra-001',
      );
      expect(result.platform_name).toBe('Google');
    });

    it('Google + osm- id: lookup succeeds → calls Places API and uses returned place.id', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork('Google', 'osm-4386938002'),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);
      httpService.post.mockReturnValue(
        of({ data: { places: [{ id: 'ChIJ_real_place_id' }] } }),
      );

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.stringContaining('https://places.googleapis.com/v1/places:searchText'),
        expect.objectContaining({ textQuery: 'Test Business' }),
      );
      expect(result.url).toBe(
        'https://search.google.com/local/writereview?placeid=ChIJ_real_place_id',
      );
      expect(result.platform_name).toBe('Google');
      expect(prisma.reviewPlatformPost.create).toHaveBeenCalled();
    });

    it('Google + osm- id: lookup returns no results → returns url: null (existing contract)', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork('Google', 'osm-4386938002'),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);
      httpService.post.mockReturnValue(of({ data: { places: [] } }));

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(httpService.post).toHaveBeenCalled();
      expect(result.url).toBeNull();
      expect(result.platform_name).toBe('Google');
      expect(prisma.reviewPlatformPost.create).toHaveBeenCalled();
    });

    it('Google + osm- id: lookup throws → returns url: null without an unhandled error', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork('Google', 'osm-4386938002'),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);
      httpService.post.mockReturnValue(throwError(() => new Error('network error')));

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(result.url).toBeNull();
      expect(result.platform_name).toBe('Google');
      expect(prisma.reviewPlatformPost.create).toHaveBeenCalled();
    });

    it('Yelp + osm- id with no usable external_url and no zembra_external_id: returns url: null instead of a broken writeareview/biz/{extId} link', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(
        makeListingWithNetwork('Yelp', 'osm-4386938002'),
      );
      prisma.userPlatformAccount.findFirst.mockResolvedValue(mockAccount);
      prisma.reviewPlatformPost.create.mockResolvedValue(mockPost);

      const result = await service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID);

      expect(result.url).toBeNull();
      expect(result.platform_name).toBe('Yelp');
      expect(result.review_text).toBe(mockReview.review_text);
      expect(prisma.reviewPlatformPost.create).toHaveBeenCalled();
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when post_auth_type is not clipboard_deeplink', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue({
        ...makeListingWithNetwork('Google', 'ChIJ...'),
        network: {
          network_id: NETWORK_ID,
          name: 'Google',
          preferences: { post_auth_type: 'oauth' },
        },
      });

      await expect(service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.reviewPlatformPost.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the review belongs to another user', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, user_id: OTHER_USER_ID });

      await expect(service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.listing.findFirst).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no listing is found for the platform', async () => {
      prisma.review.findFirst.mockResolvedValue(mockReview);
      prisma.listing.findFirst.mockResolvedValue(null);

      await expect(service.getPublishLink(USER_ID, REVIEW_ID, NETWORK_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.reviewPlatformPost.create).not.toHaveBeenCalled();
    });
  });

  // ── checkRecentReview ─────────────────────────────────────────────────────────

  describe('checkRecentReview', () => {
    it('returns hasRecentReview: true when the most recent review was created within 24 hours', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      prisma.review.findFirst.mockResolvedValue({ created_at: oneHourAgo });

      const result = await service.checkRecentReview(USER_ID, BUSINESS_ID);

      expect(prisma.review.findFirst).toHaveBeenCalledWith({
        where: { user_id: USER_ID, business_id: BUSINESS_ID, deleted_at: null },
        orderBy: { created_at: 'desc' },
        select: { created_at: true },
      });
      expect(result).toEqual({ hasRecentReview: true, lastReviewedAt: oneHourAgo.toISOString() });
    });

    it('returns hasRecentReview: false when the most recent review is older than 24 hours', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      prisma.review.findFirst.mockResolvedValue({ created_at: threeDaysAgo });

      const result = await service.checkRecentReview(USER_ID, BUSINESS_ID);

      expect(result).toEqual({ hasRecentReview: false, lastReviewedAt: threeDaysAgo.toISOString() });
    });

    it('returns hasRecentReview: false and lastReviewedAt: null when there is no review for this business', async () => {
      prisma.review.findFirst.mockResolvedValue(null);

      const result = await service.checkRecentReview(USER_ID, BUSINESS_ID);

      expect(result).toEqual({ hasRecentReview: false, lastReviewedAt: null });
    });

    it('excludes soft-deleted reviews (filtered via deleted_at: null in the query)', async () => {
      // The only review for this business is soft-deleted, so the deleted_at: null
      // filter means Prisma would find nothing — simulated here by resolving null.
      prisma.review.findFirst.mockResolvedValue(null);

      const result = await service.checkRecentReview(USER_ID, BUSINESS_ID);

      expect(prisma.review.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deleted_at: null }) }),
      );
      expect(result).toEqual({ hasRecentReview: false, lastReviewedAt: null });
    });
  });

  // ── getCategoryBreakdown ─────────────────────────────────────────────────────

  describe('getCategoryBreakdown', () => {
    it('averages each category across all reviews that have it set', async () => {
      prisma.review.findMany.mockResolvedValue([
        { category_ratings: { Food: 4, Service: 5 } },
        { category_ratings: { Food: 2, Service: 3 } },
        { category_ratings: { Food: 5 } },
      ]);

      const result = await service.getCategoryBreakdown(USER_ID);

      expect(prisma.review.findMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID, deleted_at: null },
        select: { category_ratings: true },
      });
      expect(result).toEqual({
        Food: { average: 3.67, count: 3 },
        Service: { average: 4, count: 2 },
      });
    });

    it('skips reviews where category_ratings is null', async () => {
      prisma.review.findMany.mockResolvedValue([
        { category_ratings: null },
        { category_ratings: { Food: 4 } },
      ]);

      const result = await service.getCategoryBreakdown(USER_ID);

      expect(result).toEqual({ Food: { average: 4, count: 1 } });
    });

    it('returns an empty object when the user has no reviews with category_ratings', async () => {
      prisma.review.findMany.mockResolvedValue([
        { category_ratings: null },
        { category_ratings: null },
      ]);

      const result = await service.getCategoryBreakdown(USER_ID);

      expect(result).toEqual({});
    });

    it('returns an empty object when the user has no reviews at all', async () => {
      prisma.review.findMany.mockResolvedValue([]);

      const result = await service.getCategoryBreakdown(USER_ID);

      expect(result).toEqual({});
    });

    it('rounds the average to 2 decimal places', async () => {
      prisma.review.findMany.mockResolvedValue([
        { category_ratings: { Food: 4 } },
        { category_ratings: { Food: 5 } },
        { category_ratings: { Food: 5 } },
      ]);

      const result = await service.getCategoryBreakdown(USER_ID);

      expect(result.Food.average).toBe(4.67);
      expect(result.Food.count).toBe(3);
    });
  });
});
