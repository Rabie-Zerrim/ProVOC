import * as https from 'https';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ZembraController } from './zembra.controller';
import { ZembraService } from './zembra.service';

@Module({
  imports: [
    HttpModule.register({
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 15000,
    }),
  ],
  controllers: [ZembraController],
  providers: [ZembraService],
})
export class ZembraModule {}
