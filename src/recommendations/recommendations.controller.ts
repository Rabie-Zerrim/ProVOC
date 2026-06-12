import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from '../ai/ai.service';

@ApiTags('recommendations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly aiService: AiService) {}

  @Get()
  @ApiOperation({ summary: 'Get AI-powered recommendations for the current user' })
  @ApiOkResponse({
    description: 'Recommendations from pv-ai, or [] if pv-ai is unreachable',
    schema: { type: 'array' },
  })
  getRecommendations(@Request() req) {
    return this.aiService.getRecommendations(req.user.user_id);
  }
}
