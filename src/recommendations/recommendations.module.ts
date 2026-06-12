import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { RecommendationsController } from './recommendations.controller';

@Module({
  imports: [AiModule],
  controllers: [RecommendationsController],
})
export class RecommendationsModule {}
