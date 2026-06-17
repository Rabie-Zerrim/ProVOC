import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'currentPassword123' })
  @IsString()
  @IsNotEmpty()
  current_password: string;

  // Mirrors RegisterDto's password rule (src/auth/dto/register.dto.ts).
  @ApiProperty({ example: 'newPassword456' })
  @IsString()
  @MinLength(8)
  new_password: string;
}
