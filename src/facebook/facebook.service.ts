import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

@Injectable()
export class FacebookService {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.appId = this.configService.get<string>('FACEBOOK_APP_ID', '');
    this.appSecret = this.configService.get<string>('FACEBOOK_APP_SECRET', '');
    this.redirectUri = this.configService.get<string>('FACEBOOK_REDIRECT_URI', '');
  }

  getAuthUrl(userId: string): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      scope: 'public_profile,user_posts',
      state: userId,
      response_type: 'code',
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
  }

  async handleCallback(code: string, state: string): Promise<void> {
    const userId = state;

    // Exchange authorization code for access token
    const tokenResponse = await firstValueFrom(
      this.httpService.get<{ access_token: string; expires_in?: number }>(
        'https://graph.facebook.com/v21.0/oauth/access_token',
        {
          params: {
            client_id: this.appId,
            redirect_uri: this.redirectUri,
            client_secret: this.appSecret,
            code,
          },
        },
      ),
    );
    const { access_token, expires_in } = tokenResponse.data;

    // Get the Facebook user ID via /me
    const meResponse = await firstValueFrom(
      this.httpService.get<{ id: string }>(
        'https://graph.facebook.com/v21.0/me',
        { params: { fields: 'id', access_token } },
      ),
    );
    const facebookUserId = meResponse.data.id;

    // Resolve the Facebook network record
    const network = await this.prisma.network.findFirst({
      where: { name: 'Facebook' },
    });

    if (!network) {
      throw new HttpException('Facebook network not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const tokenExpiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null;

    // Upsert the user_platform_account (no unique index on user_id+network_id so we findFirst first)
    const existing = await this.prisma.userPlatformAccount.findFirst({
      where: { user_id: userId, network_id: network.network_id },
    });

    if (existing) {
      await this.prisma.userPlatformAccount.update({
        where: { account_id: existing.account_id },
        data: {
          oauth_token: access_token,
          external_user_id: facebookUserId,
          is_active: true,
          connected_at: new Date(),
          token_expires_at: tokenExpiresAt,
        },
      });
    } else {
      await this.prisma.userPlatformAccount.create({
        data: {
          user_id: userId,
          network_id: network.network_id,
          oauth_token: access_token,
          external_user_id: facebookUserId,
          is_active: true,
          connected_at: new Date(),
          token_expires_at: tokenExpiresAt,
        },
      });
    }
  }

  async postToTimeline(
    token: string,
    reviewText: string,
    businessName: string,
  ): Promise<{ id: string }> {
    const message = businessName ? `${businessName}\n\n${reviewText}` : reviewText;
    try {
      const response = await firstValueFrom(
        this.httpService.post<{ id: string }>(
          'https://graph.facebook.com/v21.0/me/feed',
          { message },
          { params: { access_token: token } },
        ),
      );
      return response.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response) {
        throw new HttpException(axiosErr.response.data as object, HttpStatus.BAD_GATEWAY);
      }
      throw new HttpException('Facebook API unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
