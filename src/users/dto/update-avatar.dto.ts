import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// avatar_data is stored and returned as a full data URI string
// (e.g. "data:image/jpeg;base64,/9j/4AAQ...") rather than raw base64 —
// this lets the frontend pass it straight into <Image source={{ uri }}> /
// `src=` without reconstructing the MIME prefix client-side.
export class UpdateAvatarDto {
  @ApiProperty({
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...',
    description: 'Avatar image as a data URI (data:<mime>;base64,<payload>)',
  })
  @IsString()
  @IsNotEmpty()
  avatar_data: string;
}
