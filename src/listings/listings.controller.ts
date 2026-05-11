import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListingsService } from './listings.service';
import { SearchListingsDto } from './dto/search-listings.dto';
import { SaveListingDto } from './dto/save-listing.dto';

@ApiTags('listings')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Get('search')
  @ApiOperation({ summary: 'Match a business across networks via Zembra /listing/match' })
  @ApiQuery({ name: 'name', required: true, example: 'Harmony Cuisine 2B1' })
  @ApiQuery({ name: 'address', required: true, example: '3904 Convoy St 117, San Diego, CA 92111' })
  @ApiQuery({ name: 'networks[]', required: false, example: 'opentable', isArray: true })
  @ApiOkResponse({ description: 'Matched listings from Zembra' })
  search(@Query() dto: SearchListingsDto) {
    return this.listingsService.search(dto.name, dto.address, dto.networks);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a saved listing from the database' })
  @ApiParam({ name: 'id', description: 'Listing UUID' })
  @ApiOkResponse({ description: 'Listing record with business and network details' })
  findById(@Param('id') id: string) {
    return this.listingsService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Save a Zembra business into the listings table' })
  @ApiCreatedResponse({ description: 'Saved listing record' })
  save(@Body() dto: SaveListingDto) {
    return this.listingsService.save(dto);
  }
}
