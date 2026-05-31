import { IsArray, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PublishReviewDto {
  @ApiProperty({
    type: [String],
    description: 'Array of network (platform) UUIDs to post the review to',
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
  })
  @IsArray()
  @Matches(UUID_RE, { each: true, message: 'each value in platform_ids must be a UUID' })
  platform_ids: string[];
}
