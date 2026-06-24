import { IsIn, IsOptional, IsString } from 'class-validator';

export class SendMessageDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  session_id?: string;

  @IsOptional()
  @IsIn(['message', 'rephrase'])
  purpose?: 'message' | 'rephrase';
}
