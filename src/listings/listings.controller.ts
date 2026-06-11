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
  @ApiOperation({ summary: 'Search businesses via Google Places Text Search API' })
  @ApiQuery({ name: 'q', required: true, example: 'restaurants near downtown' })
  @ApiQuery({ name: 'lat', required: false, example: '37.7749' })
  @ApiQuery({ name: 'lng', required: false, example: '-122.4194' })
  @ApiOkResponse({ description: 'Matched businesses from Google Places' })
  search(@Query() dto: SearchListingsDto) {
    return this.listingsService.search(dto.q, dto.lat, dto.lng);
  }

  @Get('nearby')
  @ApiOperation({ summary: 'Proxy Overpass/OSM nearby search' })
  @ApiQuery({ name: 'lat', required: true, example: 33.88 })
  @ApiQuery({ name: 'lon', required: true, example: 10.1 })
  @ApiQuery({ name: 'amenities', required: true, example: 'restaurant,fast_food' })
  @ApiQuery({ name: 'radius', required: false, example: 3000 })
  searchNearby(
    @Query('lat') lat: string,
    @Query('lon') lon: string,
    @Query('amenities') amenities: string,
    @Query('radius') radius?: string,
  ) {
    const amenityList = amenities ? amenities.split(',').filter(Boolean) : [];
    return this.listingsService.searchNearby(
      parseFloat(lat),
      parseFloat(lon),
      amenityList,
      radius ? parseInt(radius, 10) : 3000,
    );
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
