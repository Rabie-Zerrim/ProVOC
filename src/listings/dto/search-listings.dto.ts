import { IsString, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class SearchListingsDto {
  @ApiProperty({ example: 'Harmony Cuisine 2B1' })
  @IsString()
  name: string;

  @ApiProperty({ example: '3904 Convoy St 117, San Diego, CA 92111' })
  @IsString()
  address: string;

  @ApiPropertyOptional({
    example: ['opentable', 'google'],
    description: 'Zembra network slugs to match against (e.g. google, yelp, opentable)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  networks?: string[];
}
