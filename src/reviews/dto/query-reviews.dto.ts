import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsIn,
  IsUUID,
  IsDateString,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QueryReviewsDto {
  @ApiPropertyOptional({ enum: ['draft', 'pending', 'published', 'simulated'] })
  @IsOptional()
  @IsIn(['draft', 'pending', 'published', 'simulated'])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by listing UUID' })
  @IsOptional()
  @IsUUID()
  listing_id?: string;

  @ApiPropertyOptional({ description: 'Created on or after this date (ISO 8601)', example: '2024-01-01' })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Created on or before this date (ISO 8601)', example: '2024-12-31' })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}
