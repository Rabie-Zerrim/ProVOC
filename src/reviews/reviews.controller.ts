import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { QueryReviewsDto } from './dto/query-reviews.dto';
import { PublishReviewDto } from './dto/publish-review.dto';

@ApiTags('reviews')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new review draft linked to a listing' })
  @ApiCreatedResponse({ description: 'Review draft created successfully' })
  @ApiNotFoundResponse({ description: 'Listing not found' })
  create(@Request() req, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(req.user.user_id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List reviews for the authenticated user',
    description:
      'Paginated list with full filtering by status, business, listing, date range, and text search. Supports sorting by created_at, rating, or updated_at.',
  })
  @ApiOkResponse({
    description: 'Paginated reviews with business name and listing info',
    schema: {
      properties: {
        data: { type: 'array', items: { type: 'object' } },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            page: { type: 'number' },
            limit: { type: 'number' },
            total_pages: { type: 'number' },
          },
        },
      },
    },
  })
  findAll(@Request() req, @Query() query: QueryReviewsDto) {
    return this.reviewsService.findAll(req.user.user_id, query);
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'Reviews dashboard summary',
    description:
      'Returns total review count, counts by status, last 5 recent reviews, and the top 3 most-reviewed businesses.',
  })
  @ApiOkResponse({
    description: 'Dashboard summary for the authenticated user',
    schema: {
      properties: {
        total_reviews: { type: 'number', example: 42 },
        by_status: {
          type: 'object',
          properties: {
            draft: { type: 'number' },
            pending: { type: 'number' },
            published: { type: 'number' },
            simulated: { type: 'number' },
          },
        },
        recent_reviews: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              review_id: { type: 'string' },
              business_name: { type: 'string' },
              rating: { type: 'number' },
              status: { type: 'string' },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
        },
        top_businesses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              business_id: { type: 'string' },
              name: { type: 'string' },
              review_count: { type: 'number' },
            },
          },
        },
      },
    },
  })
  getDashboard(@Request() req) {
    return this.reviewsService.getDashboard(req.user.user_id);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Review statistics for the authenticated user',
    description:
      'Returns average rating, most reviewed business category, monthly review counts, and language distribution.',
  })
  @ApiOkResponse({
    description: 'Review statistics',
    schema: {
      properties: {
        average_rating: { type: 'number', nullable: true, example: 4.2 },
        most_reviewed_category: { type: 'string', nullable: true, example: 'restaurant' },
        this_month: { type: 'number', example: 5 },
        last_month: { type: 'number', example: 8 },
        languages: {
          type: 'object',
          additionalProperties: { type: 'number' },
          example: { fr: 12, en: 5 },
        },
      },
    },
  })
  getStats(@Request() req) {
    return this.reviewsService.getStats(req.user.user_id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full details of a single review' })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiOkResponse({ description: 'Review details including business and listing info' })
  @ApiNotFoundResponse({ description: 'Review not found' })
  @ApiForbiddenResponse({ description: 'Review belongs to another user' })
  findOne(@Request() req, @Param('id') id: string) {
    return this.reviewsService.findOne(req.user.user_id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update review text, rating, tone, or status (owner only)' })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiOkResponse({ description: 'Updated review' })
  @ApiNotFoundResponse({ description: 'Review not found' })
  @ApiForbiddenResponse({ description: 'Review belongs to another user' })
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateReviewDto) {
    return this.reviewsService.update(req.user.user_id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a review (sets deleted_at, owner only)' })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiOkResponse({ description: 'Review soft-deleted' })
  @ApiNotFoundResponse({ description: 'Review not found' })
  @ApiForbiddenResponse({ description: 'Review belongs to another user' })
  remove(@Request() req, @Param('id') id: string) {
    return this.reviewsService.remove(req.user.user_id, id);
  }

  @Post(':id/publish')
  @ApiOperation({
    summary: 'Queue a review for posting to selected platforms',
    description:
      'For each platform_id: verifies a selected draft exists and the platform supports API posting, then enqueues a BullMQ job. Returns immediately with queued and skipped lists.',
  })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiBody({ type: PublishReviewDto })
  @ApiCreatedResponse({
    description: 'Jobs enqueued; includes queued platform names and skipped reasons',
    schema: {
      properties: {
        queued: { type: 'array', items: { type: 'string' }, example: ['Google', 'TripAdvisor'] },
        skipped: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              network: { type: 'string' },
              reason: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Review not found' })
  @ApiForbiddenResponse({ description: 'Review belongs to another user' })
  publish(@Request() req, @Param('id') id: string, @Body() dto: PublishReviewDto) {
    return this.reviewsService.publish(req.user.user_id, id, dto);
  }

  @Post(':id/publish/retry')
  @ApiOperation({
    summary: 'Retry failed platform posts for a review',
    description: 'Re-queues all review_platform_posts with status="failed" for this review. Increments retry_count on each.',
  })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiOkResponse({
    description: 'Number of posts re-queued',
    schema: {
      properties: { retried: { type: 'number', example: 2 } },
    },
  })
  @ApiBadRequestResponse({ description: 'No failed posts exist for this review' })
  @ApiNotFoundResponse({ description: 'Review not found' })
  @ApiForbiddenResponse({ description: 'Review belongs to another user' })
  retryFailed(@Request() req, @Param('id') id: string) {
    return this.reviewsService.retryFailed(req.user.user_id, id);
  }

  @Get(':id/posts')
  @ApiOperation({ summary: 'Get all platform post records for a review' })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiOkResponse({
    description: 'List of platform post records',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string', example: 'Google' },
          status: { type: 'string', example: 'simulated' },
          posted_at: { type: 'string', format: 'date-time', nullable: true },
          external_review_id: { type: 'string', nullable: true },
          retry_count: { type: 'number', example: 0 },
          error_message: { type: 'string', nullable: true },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Review not found' })
  @ApiForbiddenResponse({ description: 'Review belongs to another user' })
  getPosts(@Request() req, @Param('id') id: string) {
    return this.reviewsService.getPosts(req.user.user_id, id);
  }

  @Get(':id/publish-link')
  @ApiOperation({
    summary: 'Get the deep-link write-review URL for a clipboard-based platform',
    description:
      'Returns a direct URL to write a review on Google, Yelp, or Trustpilot. Requires the network to have post_auth_type=clipboard_deeplink. Creates a clipboard_opened post record.',
  })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiQuery({ name: 'platform_id', description: 'Network UUID of the target platform', required: true })
  @ApiOkResponse({
    description: 'Deep-link URL, review text, and platform name',
    schema: {
      properties: {
        url: { type: 'string', example: 'https://search.google.com/local/writereview?placeid=ChIJ...' },
        review_text: { type: 'string', example: 'Great place!' },
        platform_name: { type: 'string', example: 'Google' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Platform does not support clipboard deep links, or no deep link defined for this network' })
  @ApiNotFoundResponse({ description: 'Review not found or no listing found for this platform' })
  @ApiForbiddenResponse({ description: 'Review belongs to another user' })
  getPublishLink(
    @Request() req,
    @Param('id') id: string,
    @Query('platform_id') platformId: string,
  ) {
    return this.reviewsService.getPublishLink(req.user.user_id, id, platformId);
  }

  // ── AI Review Composer ────────────────────────────────────────────────────

  @Post(':id/transcribe')
  @ApiTags('AI Review Composer')
  @UseInterceptors(FileInterceptor('audio'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Transcribe audio and update review_text (Whisper)' })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audio'],
      properties: {
        audio: { type: 'string', format: 'binary', description: 'Audio file (webm, mp3, wav…)' },
        language: { type: 'string', example: 'fr', description: 'Hint language (optional)' },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Audio transcribed; review_text and language updated',
    schema: {
      properties: {
        transcript: { type: 'string' },
        detected_language: { type: 'string' },
        review_id: { type: 'string' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Review not found' })
  @ApiForbiddenResponse({ description: 'Review belongs to another user' })
  transcribeAudio(
    @Request() req,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('language') language: string,
  ) {
    return this.reviewsService.transcribeAudio(
      req.user.user_id,
      id,
      file.buffer,
      language ?? 'fr',
      file.mimetype,
    );
  }

  @Post(':id/chat/start')
  @ApiTags('AI Review Composer')
  @ApiOperation({ summary: 'Start an AI chat session for a review' })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiCreatedResponse({
    description: 'AI session started; session_id stored on the review',
    schema: {
      properties: {
        session_id: { type: 'string' },
        initial_response: { type: 'string' },
        detected_language: { type: 'string' },
        review_id: { type: 'string' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Review not found' })
  @ApiForbiddenResponse({ description: 'Review belongs to another user' })
  startChat(@Request() req, @Param('id') id: string) {
    return this.reviewsService.startChat(req.user.user_id, id);
  }

  @Post(':id/chat/message')
  @ApiTags('AI Review Composer')
  @ApiOperation({ summary: 'Send a message in the active AI chat session' })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['message'],
      properties: { message: { type: 'string', example: 'Make it more professional' } },
    },
  })
  @ApiCreatedResponse({
    description: 'AI response text',
    schema: {
      properties: {
        response: { type: 'string' },
        session_id: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'No active AI session for this review' })
  @ApiNotFoundResponse({ description: 'Review not found' })
  @ApiForbiddenResponse({ description: 'Review belongs to another user' })
  sendMessage(
    @Request() req,
    @Param('id') id: string,
    @Body('message') message: string,
    @Body('session_id') sessionId?: string,
  ) {
    return this.reviewsService.sendMessage(req.user.user_id, id, message, sessionId);
  }

  @Post(':id/chat/approve')
  @ApiTags('AI Review Composer')
  @ApiOperation({ summary: 'Approve the AI draft and finalize the review' })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiCreatedResponse({
    description: 'Review updated with AI-improved text; session ended',
    schema: {
      properties: {
        improved_text: { type: 'string' },
        rating: { type: 'number', example: 4 },
        sentiment: { type: 'string', example: 'positive' },
        tone: { type: 'string', example: 'professional' },
        key_points: { type: 'array', items: { type: 'string' } },
        review_id: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'No active AI session for this review' })
  @ApiNotFoundResponse({ description: 'Review not found' })
  @ApiForbiddenResponse({ description: 'Review belongs to another user' })
  approveDraft(@Request() req, @Param('id') id: string) {
    return this.reviewsService.approveDraft(req.user.user_id, id);
  }

  @Get(':id/chat/history')
  @ApiTags('AI Review Composer')
  @ApiOperation({ summary: 'Get full chat history for a review' })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiOkResponse({
    description: 'Ordered list of chat messages (user + assistant)',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          message_id: { type: 'string' },
          review_id: { type: 'string' },
          role: { type: 'string', example: 'assistant' },
          content: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Review not found' })
  @ApiForbiddenResponse({ description: 'Review belongs to another user' })
  getChatHistory(@Request() req, @Param('id') id: string) {
    return this.reviewsService.getChatHistory(req.user.user_id, id);
  }

  @Get(':id/drafts')
  @ApiTags('AI Review Composer')
  @ApiOperation({ summary: 'Get all review drafts with network info' })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiOkResponse({
    description: 'List of review drafts',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          draft_id: { type: 'string' },
          network: { type: 'string', nullable: true, example: 'Google' },
          draft_text: { type: 'string' },
          version: { type: 'number', example: 1 },
          compliance_check: { type: 'boolean', example: true },
          is_selected: { type: 'boolean', example: false },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Review not found' })
  @ApiForbiddenResponse({ description: 'Review belongs to another user' })
  getDrafts(@Request() req, @Param('id') id: string) {
    return this.reviewsService.getDrafts(req.user.user_id, id);
  }
}
