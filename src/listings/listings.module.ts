import * as https from 'https';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';

@Module({
  imports: [
    HttpModule.register({
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    }),
  ],
  controllers: [ListingsController],
  providers: [ListingsService],
})
export class ListingsModule {}
