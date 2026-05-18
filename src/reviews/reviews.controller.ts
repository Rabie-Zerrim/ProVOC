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
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { QueryReviewsDto } from './dto/query-reviews.dto';

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
  @ApiOperation({ summary: 'List all reviews for the authenticated user (paginated)' })
  @ApiOkResponse({ description: 'Paginated reviews with business name' })
  findAll(@Request() req, @Query() query: QueryReviewsDto) {
    return this.reviewsService.findAll(req.user.user_id, query);
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
}
