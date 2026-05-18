import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsInt,
  IsOptional,
  IsIn,
  IsUUID,
  Min,
  Max,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ description: 'Listing UUID this review is for' })
  @IsUUID()
  listing_id: string;

  @ApiProperty({ description: 'Review text content' })
  @IsString()
  review_text: string;

  @ApiProperty({ description: 'Rating from 1 to 5', minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ description: 'Tone of the review', enum: ['neutral', 'polite', 'firm'] })
  @IsOptional()
  @IsIn(['neutral', 'polite', 'firm'])
  tone?: string;

  @ApiPropertyOptional({ description: 'BCP-47 language code', example: 'en' })
  @IsOptional()
  @IsString()
  language?: string;
}
