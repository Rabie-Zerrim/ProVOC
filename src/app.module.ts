import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ListingsModule } from './listings/listings.module';
import { ReviewsModule } from './reviews/reviews.module';
import { FacebookModule } from './facebook/facebook.module';
import { NetworksModule } from './networks/networks.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { ZembraModule } from './zembra/zembra.module';
import { UsersModule } from './users/users.module';
import { MediaModule } from './media/media.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        if (redisUrl) {
          const url = new URL(redisUrl);
          const isTls = url.protocol === 'rediss:';
          return {
            connection: {
              host: url.hostname,
              port: parseInt(url.port, 10),
              password: url.password || undefined,
              username: url.username || undefined,
              tls: isTls ? {} : undefined,
              maxRetriesPerRequest: null,
              enableReadyCheck: false,
              family: 0,
            },
          };
        }
        return {
          connection: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
            password: configService.get<string>('REDIS_PASSWORD'),
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          },
        };
      },
      inject: [ConfigService],
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    ListingsModule,
    ReviewsModule,
    FacebookModule,
    NetworksModule,
    RecommendationsModule,
    ZembraModule,
    UsersModule,
    MediaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
