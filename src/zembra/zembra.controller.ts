import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZembraService } from './zembra.service';

@ApiTags('zembra')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('zembra')
export class ZembraController {
  constructor(private readonly zembraService: ZembraService) {}

  @Get('match')
  @ApiOperation({ summary: 'Find business review pages across Google and Yelp via Zembra' })
  @ApiQuery({ name: 'name', required: true, description: 'Business name' })
  @ApiQuery({ name: 'address', required: true, description: 'Business address' })
  @ApiOkResponse({
    description: 'Matched listing URLs per network, or {} networks if Zembra is unreachable',
    schema: {
      type: 'object',
      properties: {
        networks: {
          type: 'object',
          properties: {
            google: {
              type: 'object',
              nullable: true,
              properties: {
                url: { type: 'string' },
                rating: { type: 'number' },
                reviewCount: { type: 'number' },
              },
            },
            yelp: {
              type: 'object',
              nullable: true,
              properties: {
                url: { type: 'string' },
                rating: { type: 'number' },
                reviewCount: { type: 'number' },
              },
            },
          },
        },
      },
    },
  })
  async match(
    @Query('name') name: string,
    @Query('address') address: string,
  ) {
    try {
      const result = await this.zembraService.matchListing(name, address);
      console.log('ZEMBRA MATCH RESULT:', JSON.stringify(result));
      return result;
    } catch (err) {
      console.error('ZEMBRA MATCH ERROR:', err);
      return { networks: {} };
    }
  }
}
