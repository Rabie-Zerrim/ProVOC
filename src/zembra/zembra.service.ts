import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

const NETWORKS = ['google', 'yelp'] as const;

@Injectable()
export class ZembraService {
  private readonly apiUrl: string;
  private readonly apiToken: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.apiUrl = this.config.get<string>('ZEMBRA_API_URL') ?? '';
    this.apiToken = this.config.get<string>('ZEMBRA_API_TOKEN') ?? '';
  }

  async matchListing(name: string, address: string) {
    const results = await Promise.allSettled(
      NETWORKS.map(network => this.fetchNetwork(name, address, network)),
    );

    const networks: Record<string, { url: string; rating: number; reviewCount: number }> = {};
    results.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value !== null) {
        networks[NETWORKS[i]] = result.value;
      }
    });

    return { networks };
  }

  private async fetchNetwork(
    name: string,
    address: string,
    network: string,
  ): Promise<{ url: string; rating: number; reviewCount: number } | null> {
    try {
      const params = new URLSearchParams({ name, address });
      params.append('networks[]', network);

      const { data } = await firstValueFrom(
        this.http.get(`${this.apiUrl}/listing/match?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
          },
        }),
      );

      if (!data || data.status === 'ERROR' || !data[network]) {
        return null;
      }

      const net = data[network];
      return {
        url: net.url ?? '',
        rating: net.globalRating ?? 0,
        reviewCount: net.reviewCount?.native?.total ?? 0,
      };
    } catch {
      return null;
    }
  }
}
