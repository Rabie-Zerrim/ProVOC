import { Injectable, BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const DEFAULT_PREFERENCES = {
  default_tone: 'neutral',
  // preferred_networks holds ENABLED platform slugs. New users start with
  // the two genuinely working platforms on, not an empty (= nothing enabled) list.
  preferred_networks: ['google', 'yelp'] as string[],
  review_reminder_delay: null,
  location_tracking: true,
};

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB, measured on the decoded image bytes

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.display_name === undefined && dto.email === undefined) {
      throw new BadRequestException('At least one of display_name or email must be provided');
    }

    if (dto.email !== undefined) {
      const existing = await this.prisma.userCredential.findUnique({ where: { email: dto.email } });
      if (existing && existing.user_id !== userId) {
        throw new ConflictException('Email already registered');
      }
    }

    if (dto.display_name !== undefined) {
      await this.prisma.user.update({
        where: { user_id: userId },
        data: { display_name: dto.display_name },
      });
    }

    if (dto.email !== undefined) {
      await this.prisma.userCredential.update({
        where: { user_id: userId },
        data: { email: dto.email },
      });
    }

    const credential = await this.prisma.userCredential.findUnique({
      where: { user_id: userId },
      include: { user: true },
    });

    return {
      user_id: userId,
      email: credential?.email ?? '',
      display_name: credential?.user?.display_name ?? '',
    };
  }

  async getPreferences(userId: string) {
    return this.prisma.userPreference.upsert({
      where: { user_id: userId },
      update: {},
      create: { user_id: userId, ...DEFAULT_PREFERENCES },
    });
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    return this.prisma.userPreference.upsert({
      where: { user_id: userId },
      update: {
        ...(dto.preferred_networks !== undefined && { preferred_networks: dto.preferred_networks }),
      },
      create: {
        user_id: userId,
        ...DEFAULT_PREFERENCES,
        ...(dto.preferred_networks !== undefined && { preferred_networks: dto.preferred_networks }),
      },
    });
  }

  async updateAvatar(userId: string, dto: UpdateAvatarDto) {
    // Strip the "data:<mime>;base64," prefix if present so we measure only
    // the actual image payload, not the data URI scaffolding around it.
    const base64Payload = dto.avatar_data.includes(',')
      ? dto.avatar_data.split(',')[1]
      : dto.avatar_data;
    const decodedSize = Buffer.byteLength(base64Payload, 'base64');

    if (decodedSize > MAX_AVATAR_BYTES) {
      throw new BadRequestException(
        `Avatar image is too large (${(decodedSize / (1024 * 1024)).toFixed(2)}MB decoded) — maximum is 2MB`,
      );
    }

    await this.prisma.user.update({
      where: { user_id: userId },
      data: { avatar_data: dto.avatar_data },
    });

    return { avatar_data: dto.avatar_data };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const credential = await this.prisma.userCredential.findUnique({ where: { user_id: userId } });

    const isCurrentPasswordValid = credential
      ? await bcrypt.compare(dto.current_password, credential.password_hash)
      : false;

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newPasswordHash = await bcrypt.hash(dto.new_password, 10);

    await this.prisma.userCredential.update({
      where: { user_id: userId },
      data: { password_hash: newPasswordHash },
    });

    return { success: true };
  }
}
