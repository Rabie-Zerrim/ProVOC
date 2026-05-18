import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { QueryReviewsDto } from './dto/query-reviews.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateReviewDto) {
    const listing = await this.prisma.listing.findUnique({
      where: { listing_id: dto.listing_id },
    });
    if (!listing) throw new NotFoundException(`Listing ${dto.listing_id} not found`);

    return this.prisma.review.create({
      data: {
        user_id: userId,
        business_id: listing.business_id,
        listing_id: dto.listing_id,
        review_text: dto.review_text,
        rating: dto.rating,
        tone: dto.tone,
        language: dto.language,
        status: 'draft',
      },
      include: {
        business: { select: { name: true, address: true } },
        listing: { select: { external_url: true } },
      },
    });
  }

  async findAll(userId: string, query: QueryReviewsDto) {
    const { status, listing_id, date_from, date_to, page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      user_id: userId,
      deleted_at: null,
    };

    if (status) where.status = status;
    if (listing_id) where.listing_id = listing_id;
    if (date_from || date_to) {
      where.created_at = {
        ...(date_from ? { gte: new Date(date_from) } : {}),
        ...(date_to ? { lte: new Date(date_to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          business: { select: { name: true } },
          listing: { select: { external_url: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        last_page: Math.ceil(total / limit),
      },
    };
  }

  async findOne(userId: string, id: string) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: id, deleted_at: null },
      include: {
        business: true,
        listing: { include: { network: true } },
        user: { select: { display_name: true } },
      },
    });

    if (!review) throw new NotFoundException(`Review ${id} not found`);
    if (review.user_id !== userId) throw new ForbiddenException('Access denied');

    return review;
  }

  async update(userId: string, id: string, dto: UpdateReviewDto) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: id, deleted_at: null },
    });

    if (!review) throw new NotFoundException(`Review ${id} not found`);
    if (review.user_id !== userId) throw new ForbiddenException('Access denied');

    return this.prisma.review.update({
      where: { review_id: id },
      data: {
        ...(dto.review_text !== undefined && { review_text: dto.review_text }),
        ...(dto.rating !== undefined && { rating: dto.rating }),
        ...(dto.tone !== undefined && { tone: dto.tone }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.language !== undefined && { language: dto.language }),
      },
      include: {
        business: { select: { name: true } },
        listing: { select: { external_url: true } },
      },
    });
  }

  async remove(userId: string, id: string) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: id, deleted_at: null },
    });

    if (!review) throw new NotFoundException(`Review ${id} not found`);
    if (review.user_id !== userId) throw new ForbiddenException('Access denied');

    await this.prisma.review.update({
      where: { review_id: id },
      data: { deleted_at: new Date() },
    });

    return { message: 'Review deleted successfully' };
  }
}
