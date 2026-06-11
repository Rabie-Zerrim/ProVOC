import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchListingsDto {
  @ApiProperty({ example: 'restaurants near downtown' })
  @IsString()
  q: string;

  @ApiPropertyOptional({ example: '37.7749' })
  @IsOptional()
  @IsString()
  lat?: string;

  @ApiPropertyOptional({ example: '-122.4194' })
  @IsOptional()
  @IsString()
  lng?: string;
}
