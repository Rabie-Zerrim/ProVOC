import {
  Controller,
  Get,
  Query,
  Request,
  UseGuards,
  Redirect,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FacebookService } from './facebook.service';

@ApiTags('facebook')
@Controller('auth')
export class FacebookController {
  constructor(private readonly facebookService: FacebookService) {}

  @Get('facebook')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Redirect to Facebook OAuth consent screen' })
  @Redirect()
  getAuthUrl(@Request() req: any) {
    const url = this.facebookService.getAuthUrl(req.user.user_id);
    return { url, statusCode: 302 };
  }

  @Get('facebook/callback')
  @ApiOperation({ summary: 'Facebook OAuth callback — exchanges code and stores token' })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'state', required: true })
  @Redirect('provoc://auth/facebook/success', 302)
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    await this.facebookService.handleCallback(code, state);
  }
}
