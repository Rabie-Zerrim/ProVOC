import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ListingContextDto {
  @IsOptional()
  @IsString()
  context_note?: string;
}

export class PreviousMessageDto {
  @IsString()
  role: string;

  @IsString()
  content: string;
}

export class StartChatDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ListingContextDto)
  listing_context?: ListingContextDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreviousMessageDto)
  previous_messages?: PreviousMessageDto[];

  @IsOptional()
  @IsIn(['start', 'regenerate'])
  purpose?: 'start' | 'regenerate';
}
