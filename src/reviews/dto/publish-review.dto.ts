import { IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PublishReviewDto {
  @ApiProperty({
    type: [String],
    description: 'Array of network (platform) UUIDs to post the review to',
    example: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
  })
  @IsArray()
  @IsUUID('all', { each: true })
  platform_ids: string[];
}
