import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsIn,
  IsUUID,
  IsDateString,
  IsInt,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QueryReviewsDto {
  @ApiPropertyOptional({ enum: ['draft', 'pending', 'published', 'posted'] })
  @IsOptional()
  @IsIn(['draft', 'pending', 'published', 'posted'])
  status?: string;

  @ApiPropertyOptional({ description: 'Comma-separated list of statuses, e.g. draft,pending' })
  @IsOptional()
  @IsString()
  statuses?: string;

  @ApiPropertyOptional({ description: 'Filter by listing UUID' })
  @IsOptional()
  @IsUUID()
  listing_id?: string;

  @ApiPropertyOptional({ description: 'Filter by business UUID' })
  @IsOptional()
  @IsUUID()
  business_id?: string;

  @ApiPropertyOptional({ description: 'Created on or after this date (ISO 8601)', example: '2024-01-01' })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Created on or before this date (ISO 8601)', example: '2024-12-31' })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive substring search on review text' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['created_at', 'rating', 'updated_at'], default: 'created_at' })
  @IsOptional()
  @IsIn(['created_at', 'rating', 'updated_at'])
  sort_by?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page (max 50)', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
