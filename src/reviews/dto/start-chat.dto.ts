import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ListingContextDto {
  @IsOptional()
  @IsString()
  context_note?: string;
}

export class StartChatDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ListingContextDto)
  listing_context?: ListingContextDto;
}
