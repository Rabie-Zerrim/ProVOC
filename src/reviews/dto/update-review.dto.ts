import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsInt,
  IsOptional,
  IsIn,
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
}
