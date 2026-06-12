import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import FormData = require('form-data');

@Injectable()
export class AiService {
  private readonly baseUrl: string;
  private readonly bffSecret: string;
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>('FASTAPI_URL', 'http://localhost:5000');
    this.bffSecret = this.configService.get<string>('PJAI_SHARED_SECRET', '');
  }

  private async get<T>(path: string, headers?: Record<string, string>): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<T>(`${this.baseUrl}${path}`, { headers }),
      );
      return response.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response) {
        throw new HttpException(axiosErr.response.data as object, HttpStatus.BAD_GATEWAY);
      }
      throw new HttpException('AI service temporarily unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private async post<T>(path: string, data: unknown, headers?: Record<string, string>): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<T>(`${this.baseUrl}${path}`, data, { headers }),
      );
      return response.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response) {
        throw new HttpException(axiosErr.response.data as object, HttpStatus.BAD_GATEWAY);
      }
      throw new HttpException('AI service temporarily unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private async getPvAiToken(userId: string): Promise<string> {
    const cached = this.tokenCache.get(userId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.token;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<{ access_token: string; token_type: string; expires_in: number }>(
          `${this.baseUrl}/api/auth/token/relay`,
          { user_id: userId },
          {
            headers: {
              'X-BFF-Secret': this.bffSecret,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      const { access_token } = response.data;
      this.tokenCache.set(userId, {
        token: access_token,
        expiresAt: Date.now() + 25 * 60 * 1000,
      });
      return access_token;
    } catch {
      throw new HttpException('AI authentication service unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private async getAuthHeaders(userId: string): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.getPvAiToken(userId)}` };
  }

  async transcribeAudio(
    audioBuffer: Buffer,
    language: string,
    mimetype: string,
    userId: string,
  ): Promise<{ transcript: string; detected_language: string }> {
    const form = new FormData();
    form.append('audio', audioBuffer, { contentType: mimetype, filename: 'audio' });
    form.append('language', language);
    const authHeaders = await this.getAuthHeaders(userId);
    const raw = await this.post<any>('/api/transcribe', form, { ...form.getHeaders(), ...authHeaders });
    return {
      transcript: raw.transcription ?? raw.transcript ?? '',
      detected_language: raw.language ?? raw.detected_language ?? language,
    };
  }

  async startChat(
    reviewId: string,
    transcript: string,
    listingId: string,
    language: string,
    listingContext: object,
    userId: string,
  ): Promise<{ session_id: string; initial_response: string; detected_language: string }> {
    const body: Record<string, unknown> = {
      review_id: reviewId,
      transcript,
      listing_id: listingId,
      language,
      listing_context: listingContext,
    };
    return this.post('/api/chat/start', body, await this.getAuthHeaders(userId));
  }

  async sendMessage(
    sessionId: string,
    message: string,
    userId: string,
  ): Promise<{ response: string; session_id: string }> {
    return this.post('/api/chat/message', { session_id: sessionId, message }, await this.getAuthHeaders(userId));
  }

  async approveDraft(
    sessionId: string,
    userId: string,
  ): Promise<{
    review_text: string;
    rating: number;
    sentiment: string;
    tone: string;
    key_points: string[];
    conversation_summary: string | null;
  }> {
    const data = await this.post<any>('/api/chat/approve', { session_id: sessionId }, await this.getAuthHeaders(userId));
    return {
      review_text: data.improved_text ?? data.review_text ?? '',
      rating: data.rating,
      sentiment: data.sentiment,
      tone: data.tone,
      key_points: data.key_points ?? [],
      conversation_summary: data.conversation_summary ?? null,
    };
  }

  async endSession(sessionId: string, userId: string): Promise<{ success: boolean }> {
    return this.post('/api/chat/end', { session_id: sessionId }, await this.getAuthHeaders(userId));
  }

  async getRecommendations(userId: string): Promise<any[]> {
    try {
      const result = await this.get<any>('/api/recommendations', await this.getAuthHeaders(userId));
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }
}
