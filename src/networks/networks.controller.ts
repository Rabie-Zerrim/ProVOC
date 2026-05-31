import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NetworksService } from './networks.service';

@ApiTags('networks')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('networks')
export class NetworksController {
  constructor(private readonly networksService: NetworksService) {}

  @Get()
  @ApiOperation({ summary: 'List all active networks with slug and post_auth_type' })
  @ApiOkResponse({
    description: 'Active networks ordered by name',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          network_id: { type: 'string', example: 'uuid-net-1' },
          name: { type: 'string', example: 'Google' },
          slug: { type: 'string', example: 'google' },
          post_auth_type: { type: 'string', nullable: true, example: 'clipboard_deeplink' },
        },
      },
    },
  })
  findAll() {
    return this.networksService.findAll();
  }
}
