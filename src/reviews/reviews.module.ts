import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { PostingWorker } from './posting.worker';
import { PrismaModule } from '../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { POSTING_QUEUE } from './posting.constants';

@Module({
  imports: [
    PrismaModule,
    AiModule,
    BullModule.registerQueue({ name: POSTING_QUEUE }),
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService, PostingWorker],
})
export class ReviewsModule {}
