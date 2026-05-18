import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { PrismaService } from '../prisma/prisma.service';

const USER_ID = 'user-uuid-1';
const OTHER_USER_ID = 'user-uuid-other';
const BUSINESS_ID = 'biz-uuid-1';
const LISTING_ID = 'listing-uuid-1';
const REVIEW_ID = 'review-uuid-1';

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
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
  business: { name: 'Test Business' },
  listing: { external_url: null },
};

describe('ReviewsService', () => {
  let service: ReviewsService;
  let prisma: {
    listing: { findUnique: jest.Mock };
    review: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      listing: { findUnique: jest.fn() },
      review: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: PrismaService, useValue: prisma },
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
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 10, last_page: 1 });
    });

    it('computes correct skip for page 2', async () => {
      prisma.review.findMany.mockResolvedValue([]);
      prisma.review.count.mockResolvedValue(15);

      await service.findAll(USER_ID, { page: 2, limit: 10 });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('filters by status when provided', async () => {
      prisma.review.findMany.mockResolvedValue([mockReview]);
      prisma.review.count.mockResolvedValue(1);

      await service.findAll(USER_ID, { status: 'draft', page: 1, limit: 10 });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'draft' }),
        }),
      );
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

    it('returns last_page=1 when there are no results', async () => {
      prisma.review.findMany.mockResolvedValue([]);
      prisma.review.count.mockResolvedValue(0);

      const result = await service.findAll(USER_ID, { page: 1, limit: 10 });

      expect(result.meta.last_page).toBe(0);
      expect(result.data).toEqual([]);
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

    it('throws ForbiddenException when trying to delete another user\'s review', async () => {
      prisma.review.findFirst.mockResolvedValue({ ...mockReview, user_id: OTHER_USER_ID });

      await expect(service.remove(USER_ID, REVIEW_ID)).rejects.toThrow(ForbiddenException);
      expect(prisma.review.update).not.toHaveBeenCalled();
    });
  });
});
