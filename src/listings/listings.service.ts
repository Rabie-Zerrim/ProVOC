import { Injectable, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { SaveListingDto } from './dto/save-listing.dto';

const SLUG_TO_NAME: Record<string, string> = {
  google:      'Google',
  yelp:        'Yelp',
  tripadvisor: 'TripAdvisor',
  facebook:    'Facebook',
  trustpilot:  'Trustpilot',
};

@Injectable()
export class ListingsService {
  private readonly googlePlacesApiKey: string;

  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.googlePlacesApiKey = this.config.get<string>('GOOGLE_PLACES_API_KEY') ?? '';
  }

  async search(q: string, lat?: string, lng?: string) {
    const body: Record<string, any> = { textQuery: q };

    if (lat && lng) {
      body.locationBias = {
        circle: {
          center: { latitude: parseFloat(lat), longitude: parseFloat(lng) },
          radius: 5000.0,
        },
      };
    }

    try {
      const fields = 'places.id,places.displayName,places.formattedAddress,places.rating,places.location,places.photos';
      const url = `https://places.googleapis.com/v1/places:searchText?key=${this.googlePlacesApiKey}&fields=${fields}`;
      const { data } = await firstValueFrom(this.http.post(url, body));
      const mapped: Record<string, any> = {};
      (data.places ?? []).forEach((place: any, index: number) => {
        const key = index === 0 ? 'google' : `google_${index}`;
        mapped[key] = {
          id: place.id,
          name: place.displayName?.text ?? '',
          formattedAddress: place.formattedAddress ?? '',
          globalRating: place.rating ?? 0,
          reviewCount: 0,
          url: '',
          photo_reference: place.photos?.[0]?.name ?? null,
        };
        console.log('PHOTO_REF:', place.photos?.[0]?.name ?? 'NO_PHOTO');
      });
      return mapped;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 400 || status === 404) return {};
      throw err;
    }
  }

  async searchNearby(lat: number, lon: number, amenities: string[], radius = 5000) {
    const deltaLat = radius / 111000;
    const deltaLon = radius / (111000 * Math.cos((lat * Math.PI) / 180));
    const viewbox = `${lon - deltaLon},${lat + deltaLat},${lon + deltaLon},${lat - deltaLat}`;

    const terms = [...new Set(amenities)].slice(0, 3);
    const seen = new Set<string>();
    const results: any[] = [];

    for (const term of terms) {
      try {
        const qs = new URLSearchParams({ q: term, format: 'json', limit: '15', viewbox, bounded: '1' });
        // Nominatim usage policy: identify the app with User-Agent + contact email,
        // include Accept-Language, and stay under 1 request/second.
        // https://operations.osmfoundation.org/policies/nominatim/
        const { data } = await firstValueFrom(
          this.http.get(`https://nominatim.openstreetmap.org/search?${qs.toString()}`, {
            headers: {
              'User-Agent': 'ProVOC/1.0 (contact@provoc.app)',
              'Accept-Language': 'en',
              'Referer': 'https://provoc-production.up.railway.app',
            },
            timeout: 15000,
          }),
        );
        for (const r of data ?? []) {
          if (r.name && !seen.has(String(r.osm_id))) {
            seen.add(String(r.osm_id));
            results.push({
              id: String(r.osm_id),
              name: r.name,
              address: (r.display_name as string).split(',').slice(1, 4).join(',').trim(),
              lat: parseFloat(r.lat),
              lon: parseFloat(r.lon),
              type: r.type ?? r.class ?? 'place',
            });
          }
        }
      } catch {}
    }

    return { items: results.slice(0, 25) };
  }

  private async ensureNetwork(slug: string) {
    const name = SLUG_TO_NAME[slug.toLowerCase()] ?? slug;
    let network = await this.prisma.network.findFirst({ where: { name } });
    if (!network) {
      network = await this.prisma.network.create({ data: { name, is_active: true } });
    }
    const prefs = await this.prisma.networkPreference.findUnique({ where: { network_id: network.network_id } });
    if (!prefs) {
      await this.prisma.networkPreference.create({
        data: {
          network_id: network.network_id,
          post_auth_type: 'clipboard_deeplink',
          supports_api_posting: false,
          supports_api_reply: false,
          rating_type: 'star',
          rating_scale_min: 1,
          rating_scale_max: 5,
        },
      });
    }
    return network;
  }

  private async listingsToNetworks(businessId: string) {
    const all = await this.prisma.listing.findMany({
      where: { business_id: businessId, is_active: true },
      include: { network: true },
    });
    return all.map((l) => ({
      id: l.network.network_id,
      network_id: l.network.network_id,
      name: l.network.name,
      slug: l.network.name.toLowerCase().replace(/\s+/g, ''),
    }));
  }

  async findById(id: string) {
    let listing = await this.prisma.listing.findUnique({
      where: { listing_id: id },
      include: { business: true, network: true },
    });

    if (!listing) throw new NotFoundException(`Listing ${id} not found`);

    // Migrate legacy "Zembra" entries to Google on first access
    if (listing.network.name === 'Zembra') {
      const google = await this.ensureNetwork('google');
      await this.prisma.listing.update({
        where: { listing_id: id },
        data: { network_id: google.network_id },
      });
      listing = { ...listing, network_id: google.network_id, network: google } as any;
    }

    const networks = await this.listingsToNetworks(listing.business_id);
    return { ...listing, networks: networks ?? [] };
  }

  async save(dto: SaveListingDto) {
    const existing = await this.prisma.listing.findFirst({
      where: { external_listing_id: dto.external_listing_id },
      include: { business: true, network: true },
    });
    if (existing) {
      if (existing.network.name === 'Zembra') {
        return this.findById(existing.listing_id);
      }
      const networks = await this.listingsToNetworks(existing.business_id);
      return { ...existing, networks: networks ?? [] };
    }

    let network: Awaited<ReturnType<typeof this.prisma.network.findFirst>>;

    if (dto.network_slug) {
      const candidateName = SLUG_TO_NAME[dto.network_slug.toLowerCase()] ?? dto.network_slug;
      network = await this.prisma.network.findFirst({
        where: { name: { equals: candidateName, mode: 'insensitive' } },
      });
    }

    if (!network) {
      network = await this.ensureNetwork(dto.network_slug ?? dto.network ?? 'google');
    }

    // Reuse an existing business record when business_id is provided (multi-platform save)
    let businessId = dto.business_id;
    if (!businessId) {
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
      businessId = business.business_id;
    }

    const created = await this.prisma.listing.create({
      data: {
        business_id: businessId,
        network_id: network.network_id,
        external_listing_id: dto.external_listing_id,
        external_rating: dto.external_rating,
        external_url: dto.external_url,
        last_synced_at: new Date(),
      },
      include: { business: true, network: true },
    });
    const networks = await this.listingsToNetworks(businessId);
    return { ...created, networks: networks ?? [] };
  }
}
