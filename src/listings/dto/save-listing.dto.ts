import { IsString, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SaveListingDto {
  @ApiProperty({ example: 'zembra-biz-001', description: "Zembra's unique ID for this business" })
  @IsString()
  external_listing_id: string;

  @ApiProperty({ example: 'Pizza Roma' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: '12 Rue de la Paix, Paris' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'restaurant' })
  @IsOptional()
  @IsString()
  business_type?: string;

  @ApiPropertyOptional({ example: 4.5 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  external_rating?: number;

  @ApiPropertyOptional({ example: 'https://zembra.io/listing/biz-001' })
  @IsOptional()
  @IsString()
  external_url?: string;

  @ApiPropertyOptional({ example: 'google', description: 'Network slug (google, yelp, tripadvisor, facebook, trustpilot)' })
  @IsOptional()
  @IsString()
  network?: string;

  @ApiPropertyOptional({ example: 'google', description: 'Look up an existing network by slug (case-insensitive). Preferred over network when the network is already seeded.' })
  @IsOptional()
  @IsString()
  network_slug?: string;

  @ApiPropertyOptional({ description: 'Existing business UUID to attach this listing to instead of creating a new business' })
  @IsOptional()
  @IsString()
  business_id?: string;

  @ApiPropertyOptional({ example: 48.8698 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional({ example: 2.3078 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  longitude?: number;
}
