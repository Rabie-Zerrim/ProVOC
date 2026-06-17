import { IsArray, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePreferencesDto {
  @ApiPropertyOptional({
    example: ['yelp', 'tripadvisor'],
    description: 'Network slugs the user has toggled off (empty array means no exclusions)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferred_networks?: string[];
}
