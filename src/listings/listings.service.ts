import { Injectable, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { SaveListingDto } from './dto/save-listing.dto';

const ZEMBRA_NETWORK_NAME = 'Zembra';

@Injectable()
export class ListingsService {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('ZEMBRA_API_KEY') ?? '';
    this.baseUrl = this.config.get<string>('ZEMBRA_BASE_URL') ?? 'https://api.zembra.io';
  }

  async search(name: string, address: string, networks?: string[]) {
    const qs = new URLSearchParams({ name, address });
    networks?.forEach((n) => qs.append('networks[]', n));

    const { data } = await firstValueFrom(
      this.http.get(`${this.baseUrl}/listing/match?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      }),
    );

    return data;
  }

  async findById(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { listing_id: id },
      include: { business: true, network: true },
    });

    if (!listing) throw new NotFoundException(`Listing ${id} not found`);
    return listing;
  }

  async save(dto: SaveListingDto) {
    const existing = await this.prisma.listing.findFirst({
      where: { external_listing_id: dto.external_listing_id },
      include: { business: true, network: true },
    });
    if (existing) return existing;

    let network = await this.prisma.network.findFirst({
      where: { name: ZEMBRA_NETWORK_NAME },
    });
    if (!network) {
      network = await this.prisma.network.create({
        data: { name: ZEMBRA_NETWORK_NAME, base_url: this.baseUrl, is_active: true },
      });
    }

    const business = await this.prisma.business.create({
      data: {
        name: dto.name,
        address: dto.address,
        business_type: dto.business_type,
        latitude: dto.latitude,
        longitude: dto.longitude,
        is_active: true,
      },
    });

    return this.prisma.listing.create({
      data: {
        business_id: business.business_id,
        network_id: network.network_id,
        external_listing_id: dto.external_listing_id,
        external_rating: dto.external_rating,
        external_url: dto.external_url,
        last_synced_at: new Date(),
      },
      include: { business: true, network: true },
    });
  }
}
