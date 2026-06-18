import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsInt,
  IsOptional,
  IsIn,
  IsObject,
  Min,
  Max,
} from 'class-validator';

export class UpdateReviewDto {
  @ApiPropertyOptional({ description: 'Updated review text' })
  @IsOptional()
  @IsString()
  review_text?: string;

  @ApiPropertyOptional({ description: 'Updated rating (1–5)', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ description: 'Updated tone', enum: ['neutral', 'polite', 'firm'] })
  @IsOptional()
  @IsIn(['neutral', 'polite', 'firm'])
  tone?: string;

  @ApiPropertyOptional({
    description: 'Updated status',
    enum: ['draft', 'pending', 'published', 'simulated'],
  })
  @IsOptional()
  @IsIn(['draft', 'pending', 'published', 'simulated'])
  status?: string;

  @ApiPropertyOptional({ description: 'BCP-47 language code', example: 'en' })
  @IsOptional()
  @IsString()
  language?: string;

  // Keys vary by business type (e.g. "Food", "Service", "Atmosphere" for a
  // restaurant; "Rooms", "Cleanliness" for a hotel — see pv-app's
  // BUSINESS_TYPE_CATEGORIES), so a fixed key whitelist isn't practical here.
  // Shape validation stops at "is a plain object" at the DTO layer; each
  // value is checked to be a number in [1, 5] in ReviewsService.update().
  @ApiPropertyOptional({
    description: 'Per-category self-rated scores (1-5), e.g. { "Food": 4, "Service": 5 }',
    example: { Food: 4, Service: 5, Atmosphere: 3 },
  })
  @IsOptional()
  @IsObject()
  category_ratings?: Record<string, number>;
}
