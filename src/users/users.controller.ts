import { Controller, Get, Patch, Body, UseGuards, Request } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

@ApiTags('users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('me')
  @ApiOperation({ summary: "Update the current user's profile (display_name and/or email)" })
  @ApiOkResponse({
    description: 'Updated profile',
    schema: {
      properties: {
        user_id: { type: 'string' },
        email: { type: 'string' },
        display_name: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Neither display_name nor email was provided' })
  @ApiConflictResponse({ description: 'Email already registered to another user' })
  updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.user_id, dto);
  }

  @Get('me/preferences')
  @ApiOperation({ summary: "Get the current user's platform preferences (creates defaults on first access)" })
  @ApiOkResponse({ description: 'User preferences' })
  getPreferences(@Request() req) {
    return this.usersService.getPreferences(req.user.user_id);
  }

  @Patch('me/preferences')
  @ApiOperation({ summary: "Update the current user's preferred_networks list" })
  @ApiOkResponse({ description: 'Updated preferences' })
  updatePreferences(@Request() req, @Body() dto: UpdatePreferencesDto) {
    return this.usersService.updatePreferences(req.user.user_id, dto);
  }
}
