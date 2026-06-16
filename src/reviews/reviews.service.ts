import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { QueryReviewsDto } from './dto/query-reviews.dto';
import { PublishReviewDto } from './dto/publish-review.dto';
import { POSTING_QUEUE, PostingJobData } from './posting.constants';
import { StartChatDto } from './dto/start-chat.dto';

const REVIEW_STATUSES = ['draft', 'pending', 'published', 'posted'] as const;
type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const GOOGLE_PLACE_ID_PATTERN = /^ChIJ[A-Za-z0-9_-]+$/;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(POSTING_QUEUE) private readonly postingQueue: Queue,
    private readonly aiService: AiService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

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
    const {
      status,
      statuses,
      listing_id,
      business_id,
      date_from,
      date_to,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      page = 1,
      limit = 10,
    } = query;

    const safeLimit = Math.min(limit, 50);
    const skip = (page - 1) * safeLimit;

    const where: Record<string, unknown> = {
      user_id: userId,
      deleted_at: null,
    };

    if (statuses) {
      const list = statuses.split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length === 1) where.status = list[0];
      else if (list.length > 1) where.status = { in: list };
    } else if (status) {
      where.status = status;
    }
    if (listing_id) where.listing_id = listing_id;
    if (business_id) where.business_id = business_id;
    if (search) where.review_text = { contains: search, mode: 'insensitive' };
    if (date_from || date_to) {
      where.created_at = {
        ...(date_from ? { gte: new Date(date_from) } : {}),
        ...(date_to ? { lte: new Date(date_to) } : {}),
      };
    }

    const validSortFields = ['created_at', 'rating', 'updated_at'];
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortDirection = sort_order === 'asc' ? 'asc' : 'desc';

    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: { [sortField]: sortDirection },
        select: {
          review_id: true,
          business_id: true,
          listing_id: true,
          review_text: true,
          rating: true,
          status: true,
          tone: true,
          language: true,
          created_at: true,
          updated_at: true,
          business: { select: { name: true, business_type: true } },
          listing: { select: { listing_id: true, external_url: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit: safeLimit,
        total_pages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getDashboard(userId: string) {
    const baseWhere = { user_id: userId, deleted_at: null };

    const [total_reviews, by_status_raw, recent_reviews, top_businesses_raw] =
      await Promise.all([
        this.prisma.review.count({ where: baseWhere }),
        this.prisma.review.groupBy({
          by: ['status'],
          where: baseWhere,
          _count: { status: true },
        }),
        this.prisma.review.findMany({
          where: baseWhere,
          orderBy: { created_at: 'desc' },
          take: 5,
          select: {
            review_id: true,
            rating: true,
            status: true,
            created_at: true,
            business: { select: { name: true } },
          },
        }),
        this.prisma.review.groupBy({
          by: ['business_id'],
          where: baseWhere,
          _count: { business_id: true },
          orderBy: { _count: { business_id: 'desc' } },
          take: 3,
        }),
      ]);

    const by_status = Object.fromEntries(
      REVIEW_STATUSES.map((s) => [
        s,
        by_status_raw.find((r) => r.status === s)?._count.status ?? 0,
      ]),
    ) as Record<ReviewStatus, number>;

    const topBusinessIds = top_businesses_raw.map((b) => b.business_id);
    const businesses = await this.prisma.business.findMany({
      where: { business_id: { in: topBusinessIds } },
      select: { business_id: true, name: true },
    });
    const businessMap = new Map(businesses.map((b) => [b.business_id, b.name]));

    return {
      total_reviews,
      by_status,
      recent_reviews: recent_reviews.map((r) => ({
        review_id: r.review_id,
        business_name: r.business.name,
        rating: r.rating,
        status: r.status,
        created_at: r.created_at,
      })),
      top_businesses: top_businesses_raw.map((b) => ({
        business_id: b.business_id,
        name: businessMap.get(b.business_id) ?? '',
        review_count: b._count.business_id,
      })),
    };
  }

  async getStats(userId: string) {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = thisMonthStart;

    const baseWhere = { user_id: userId, deleted_at: null };

    const [avgResult, thisMonth, lastMonth, languageGroups, categoryResult] =
      await Promise.all([
        this.prisma.review.aggregate({
          where: baseWhere,
          _avg: { rating: true },
        }),
        this.prisma.review.count({
          where: { ...baseWhere, created_at: { gte: thisMonthStart } },
        }),
        this.prisma.review.count({
          where: {
            ...baseWhere,
            created_at: { gte: lastMonthStart, lt: lastMonthEnd },
          },
        }),
        this.prisma.review.groupBy({
          by: ['language'],
          where: baseWhere,
          _count: { language: true },
        }),
        this.prisma.$queryRaw<Array<{ business_type: string }>>`
          SELECT b.business_type
          FROM reviews r
          JOIN businesses b ON r.business_id = b.business_id
          WHERE r.user_id = ${userId}::uuid
            AND r.deleted_at IS NULL
            AND b.business_type IS NOT NULL
          GROUP BY b.business_type
          ORDER BY COUNT(*) DESC
          LIMIT 1
        `,
      ]);

    const languages: Record<string, number> = {};
    for (const group of languageGroups) {
      if (group.language) {
        languages[group.language] = group._count.language;
      }
    }

    const raw = avgResult._avg.rating;
    const average_rating = raw !== null ? Math.round(raw * 100) / 100 : null;

    return {
      average_rating,
      most_reviewed_category: categoryResult[0]?.business_type ?? null,
      this_month: thisMonth,
      last_month: lastMonth,
      languages,
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

    const allListings = await this.prisma.listing.findMany({
      where: { business_id: review.business_id, is_active: true },
      include: { network: { select: { network_id: true, name: true } } },
    });
    const networks = allListings.map((l) => ({
      network_id: l.network.network_id,
      id: l.network.network_id,
      name: l.network.name,
      slug: l.network.name.toLowerCase().replace(/\s+/g, ''),
    }));

    return {
      ...review,
      listing: review.listing ? { ...review.listing, networks } : null,
    };
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

  async publish(userId: string, reviewId: string, dto: PublishReviewDto) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: reviewId, deleted_at: null },
    });
    if (!review) throw new NotFoundException(`Review ${reviewId} not found`);
    if (review.user_id !== userId) throw new ForbiddenException('Access denied');

    const queued: string[] = [];
    const skipped: { network: string; reason: string }[] = [];

    for (const networkId of dto.platform_ids) {
      const network = await this.prisma.network.findUnique({
        where: { network_id: networkId },
        include: { preferences: true },
      });

      if (!network) {
        skipped.push({ network: networkId, reason: 'Network not found' });
        continue;
      }

      const draft = await this.prisma.reviewDraft.findFirst({
        where: { review_id: reviewId, network_id: networkId, is_selected: true },
      });
      const draftText = draft?.draft_text ?? review.review_text;
      if (!draftText) {
        skipped.push({ network: network.name, reason: 'No selected draft for this platform' });
        continue;
      }

      if (!network.preferences?.supports_api_posting) {
        skipped.push({ network: network.name, reason: 'Platform does not support API posting' });
        continue;
      }

      const post = await this.prisma.reviewPlatformPost.create({
        data: {
          review_id: reviewId,
          network_id: networkId,
          listing_id: review.listing_id,
          status: 'queued',
          platform_specific_text: draftText,
          retry_count: 0,
        },
      });

      await this.postingQueue.add(
        'post-review',
        {
          post_id: post.post_id,
          review_id: reviewId,
          network_id: networkId,
          network_name: network.name,
          draft_text: draftText,
          user_id: userId,
          listing_id: review.listing_id,
        } as PostingJobData,
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );

      queued.push(network.name);
    }

    return { queued, skipped };
  }

  async retryFailed(userId: string, reviewId: string) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: reviewId, deleted_at: null },
    });
    if (!review) throw new NotFoundException(`Review ${reviewId} not found`);
    if (review.user_id !== userId) throw new ForbiddenException('Access denied');

    const failedPosts = await this.prisma.reviewPlatformPost.findMany({
      where: { review_id: reviewId, status: 'failed' },
      include: { network: true },
    });

    if (failedPosts.length === 0) {
      throw new BadRequestException('No failed posts found for this review');
    }

    for (const post of failedPosts) {
      const draft = await this.prisma.reviewDraft.findFirst({
        where: { review_id: reviewId, network_id: post.network_id, is_selected: true },
      });

      await this.prisma.reviewPlatformPost.update({
        where: { post_id: post.post_id },
        data: { retry_count: { increment: 1 }, status: 'queued' },
      });

      await this.postingQueue.add(
        'post-review',
        {
          post_id: post.post_id,
          review_id: reviewId,
          network_id: post.network_id,
          network_name: post.network.name,
          draft_text: draft?.draft_text ?? post.platform_specific_text ?? '',
          user_id: userId,
          listing_id: post.listing_id,
        } as PostingJobData,
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    }

    return { retried: failedPosts.length };
  }

  async getPosts(userId: string, reviewId: string) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: reviewId, deleted_at: null },
    });
    if (!review) throw new NotFoundException(`Review ${reviewId} not found`);
    if (review.user_id !== userId) throw new ForbiddenException('Access denied');

    const posts = await this.prisma.reviewPlatformPost.findMany({
      where: { review_id: reviewId },
      include: { network: { select: { name: true } } },
    });

    return posts.map((p) => ({
      platform: p.network.name,
      status: p.status,
      posted_at: p.posted_at,
      external_review_id: p.external_review_id,
      retry_count: p.retry_count,
      error_message: p.error_message,
    }));
  }

  async transcribeAudio(
    userId: string,
    reviewId: string,
    audioBuffer: Buffer,
    language: string,
    mimetype: string,
  ) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: reviewId, deleted_at: null },
    });
    if (!review) throw new NotFoundException(`Review ${reviewId} not found`);
    if (review.user_id !== userId) throw new ForbiddenException('Access denied');

    const result = await this.aiService.transcribeAudio(audioBuffer, language, mimetype, userId);

    await this.prisma.review.update({
      where: { review_id: reviewId },
      data: { review_text: result.transcript, language: result.detected_language },
    });

    return { transcript: result.transcript, detected_language: result.detected_language, review_id: reviewId };
  }

  async startChat(userId: string, reviewId: string, body?: StartChatDto) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: reviewId, deleted_at: null },
      include: {
        business: { select: { name: true } },
      },
    });
    if (!review) throw new NotFoundException(`Review ${reviewId} not found`);
    if (review.user_id !== userId) throw new ForbiddenException('Access denied');

    const allListings = await this.prisma.listing.findMany({
      where: { business_id: review.business_id, is_active: true },
      include: {
        network: { include: { preferences: true } },
      },
    });

    const listingContext = {
      business_name: review.business.name,
      networks: allListings.map((l) => ({
        name: l.network.name,
        max_chars: l.network.preferences?.max_chars_post ?? null,
        supports_api_posting: l.network.preferences?.supports_api_posting ?? false,
      })),
      context_note: body?.listing_context?.context_note ?? '',
    };

    const summaryContext = review.conversation_summary
      ? `\nContext from previous session:\n${review.conversation_summary}`
      : '';

    const transcript = review.review_text
      ? `The current review text is: "${review.review_text}".${summaryContext}\nThe user wants to continue refining it. Ask them what they would like to change.`
      : review.review_text;

    const result = await this.aiService.startChat(
      reviewId,
      transcript,
      review.listing_id ?? '',
      review.language ?? 'fr',
      listingContext,
      userId,
    );

    await this.prisma.review.update({
      where: { review_id: reviewId },
      data: { ai_session_id: result.session_id },
    });

    return { ...result, review_id: reviewId };
  }

  async sendMessage(userId: string, reviewId: string, message: string, sessionId?: string) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: reviewId, deleted_at: null },
    });
    if (!review) throw new NotFoundException(`Review ${reviewId} not found`);
    if (review.user_id !== userId) throw new ForbiddenException('Access denied');

    const sid = sessionId ?? review.ai_session_id;
    if (!sid) throw new BadRequestException('No active AI session for this review');

    const aiResponse = await this.aiService.sendMessage(sid, message, userId);

    if (!message.startsWith('Please rewrite this review')) {
      await this.prisma.reviewChatMessage.createMany({
        data: [
          { review_id: reviewId, role: 'user', content: message },
          { review_id: reviewId, role: 'assistant', content: aiResponse.response },
        ],
      });
    }

    return aiResponse;
  }

  async approveDraft(userId: string, reviewId: string) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: reviewId, deleted_at: null },
    });
    if (!review) throw new NotFoundException(`Review ${reviewId} not found`);
    if (review.user_id !== userId) throw new ForbiddenException('Access denied');
    if (!review.ai_session_id) throw new BadRequestException('No active AI session for this review');

    const sessionId = review.ai_session_id;
    const result = await this.aiService.approveDraft(sessionId, userId);

    await this.prisma.review.update({
      where: { review_id: reviewId },
      data: {
        review_text: result.review_text,
        rating: result.rating,
        tone: result.tone,
        status: 'pending',
        ai_session_id: null,
        conversation_summary: result.conversation_summary,
      },
    });

    const existingDraft = await this.prisma.reviewDraft.findFirst({
      where: { review_id: reviewId },
    });

    await this.prisma.reviewDraft.upsert({
      where: { draft_id: existingDraft?.draft_id ?? '00000000-0000-0000-0000-000000000000' },
      create: {
        review_id: reviewId,
        draft_text: result.review_text,
        is_selected: true,
      },
      update: {
        draft_text: result.review_text,
        is_selected: true,
      },
    });

    await this.prisma.reviewDraft.updateMany({
      where: { review_id: reviewId, is_selected: true },
      data: { draft_text: result.review_text },
    });

    await this.aiService.endSession(sessionId, userId);

    return { ...result, review_id: reviewId };
  }

  private async lookupGooglePlaceId(
    name: string,
    latitude: number | null,
    longitude: number | null,
  ): Promise<string | null> {
    try {
      const body: Record<string, any> = { textQuery: name };
      if (latitude != null && longitude != null) {
        body.locationBias = {
          circle: {
            center: { latitude, longitude },
            radius: 5000.0,
          },
        };
      }
      const apiKey = this.config.get<string>('GOOGLE_PLACES_API_KEY');
      const fields = 'places.id';
      const url = `https://places.googleapis.com/v1/places:searchText?key=${apiKey}&fields=${fields}`;
      const { data } = await firstValueFrom(this.http.post(url, body));
      return data?.places?.[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  private extractGoogleLinkFromExternalUrl(externalUrl: string | null | undefined): string | null {
    if (!externalUrl) return null;
    try {
      const parsed = new URL(externalUrl);
      const placeIdParam = parsed.searchParams.get('placeid') ?? parsed.searchParams.get('place_id');
      if (placeIdParam && GOOGLE_PLACE_ID_PATTERN.test(placeIdParam)) {
        return `https://search.google.com/local/writereview?placeid=${placeIdParam}`;
      }
      const isGoogleDomain = /(^|\.)google\.[a-z.]+$/.test(parsed.hostname);
      return isGoogleDomain ? externalUrl : null;
    } catch {
      return null;
    }
  }

  async getPublishLink(userId: string, reviewId: string, platformId: string) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: reviewId, deleted_at: null },
      include: { business: { select: { name: true, latitude: true, longitude: true } } },
    });
    if (!review) throw new NotFoundException(`Review ${reviewId} not found`);
    if (review.user_id !== userId) throw new ForbiddenException('Access denied');

    // Find the listing for this business on the specific platform
    let listing = await this.prisma.listing.findFirst({
      where: { business_id: review.business_id, network_id: platformId },
      include: { network: { include: { preferences: true } } },
    });
    // Fall back to any listing for this business (handles legacy single-listing data)
    if (!listing) {
      listing = await this.prisma.listing.findFirst({
        where: { business_id: review.business_id },
        include: { network: { include: { preferences: true } } },
      });
    }
    if (!listing) throw new NotFoundException('No listing found for this business');

    if (listing.network?.preferences?.post_auth_type !== 'clipboard_deeplink') {
      throw new BadRequestException('Platform does not support clipboard deep links, or no deep link defined for this network');
    }

    const networkName = listing.network.name;
    const extId = listing.external_listing_id ?? '';
    const bizName = review.business.name;

    const looksLikeGooglePlaceId =
      networkName !== 'Google' || GOOGLE_PLACE_ID_PATTERN.test(listing.external_listing_id ?? '');

    const hasValidId =
      !!listing.external_listing_id &&
      !listing.external_listing_id.startsWith('osm-') &&
      !listing.external_listing_id.startsWith('manual-') &&
      looksLikeGooglePlaceId;

    let url: string | null = null;

    if (hasValidId) {
      if (networkName === 'Google') {
        url = `https://search.google.com/local/writereview?placeid=${extId}`;
      } else if (networkName === 'Yelp') {
        url = `https://www.yelp.com/writeareview/biz/${extId}`;
      } else if (networkName === 'TripAdvisor') {
        url = `https://www.tripadvisor.com/Search?q=${encodeURIComponent(bizName)}`;
      } else if (networkName === 'Facebook') {
        url = `https://www.facebook.com/search/top?q=${encodeURIComponent(bizName)}`;
      } else if (networkName === 'Trustpilot') {
        const reviewPath = listing.external_url?.split('/review/').pop();
        url = reviewPath
          ? `https://www.trustpilot.com/evaluate/${reviewPath}`
          : `https://www.trustpilot.com/evaluate/${encodeURIComponent(bizName.toLowerCase().replace(/\s+/g, '-'))}`;
      } else {
        url = `https://maps.google.com/?q=${encodeURIComponent(bizName)}`;
      }
    } else if (networkName === 'Google') {
      const linkFromExternalUrl = this.extractGoogleLinkFromExternalUrl(listing.external_url);
      if (linkFromExternalUrl) {
        url = linkFromExternalUrl;
      } else {
        const latitude = review.business.latitude != null ? Number(review.business.latitude) : null;
        const longitude = review.business.longitude != null ? Number(review.business.longitude) : null;
        const realPlaceId = await this.lookupGooglePlaceId(bizName, latitude, longitude);
        url = realPlaceId
          ? `https://search.google.com/local/writereview?placeid=${realPlaceId}`
          : null;
      }
    }

    let account = await this.prisma.userPlatformAccount.findFirst({
      where: { user_id: userId, network_id: platformId, is_active: true },
    });
    if (!account) {
      account = await this.prisma.userPlatformAccount.create({
        data: { user_id: userId, network_id: platformId, is_active: false },
      });
    }

    await this.prisma.reviewPlatformPost.create({
      data: {
        review_id: reviewId,
        network_id: platformId,
        listing_id: listing.listing_id,
        user_platform_account_id: account.account_id,
        status: 'clipboard_opened',
        retry_count: 0,
      },
    });

    return {
      url,
      review_text: review.review_text,
      platform_name: networkName,
    };
  }

  async getChatHistory(userId: string, reviewId: string) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: reviewId, deleted_at: null },
    });
    if (!review) throw new NotFoundException(`Review ${reviewId} not found`);
    if (review.user_id !== userId) throw new ForbiddenException('Access denied');

    return this.prisma.reviewChatMessage.findMany({
      where: { review_id: reviewId },
      orderBy: { created_at: 'asc' },
    });
  }

  async getDrafts(userId: string, reviewId: string) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: reviewId, deleted_at: null },
    });
    if (!review) throw new NotFoundException(`Review ${reviewId} not found`);
    if (review.user_id !== userId) throw new ForbiddenException('Access denied');

    const drafts = await this.prisma.reviewDraft.findMany({
      where: { review_id: reviewId },
      include: { network: { select: { name: true } } },
      orderBy: { created_at: 'asc' },
    });

    return drafts.map((d) => ({
      draft_id: d.draft_id,
      network: d.network?.name ?? null,
      draft_text: d.draft_text,
      version: d.version,
      compliance_check: d.compliance_check,
      is_selected: d.is_selected,
      created_at: d.created_at,
    }));
  }
}
