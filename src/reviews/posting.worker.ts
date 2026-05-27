import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { POSTING_QUEUE, PostingJobData } from './posting.constants';

@Processor(POSTING_QUEUE)
export class PostingWorker extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<PostingJobData>): Promise<void> {
    const { post_id, review_id, network_name, draft_text, user_id } = job.data;
    const now = new Date();

    await this.prisma.reviewPlatformPost.update({
      where: { post_id },
      data: {
        status: 'simulated',
        platform_specific_text: draft_text,
        posted_at: now,
        external_review_id: `SIMULATED-${randomUUID()}`,
      },
    });

    await this.prisma.review.update({
      where: { review_id },
      data: { status: 'published' },
    });

    await this.prisma.notification.create({
      data: {
        user_id,
        type: 'posting',
        category: 'review',
        title: 'Review submitted',
        body: `Your review was submitted to ${network_name}`,
        is_sent: true,
        sent_at: now,
      },
    });

    console.log(`[PostingWorker] ${review_id} posted to ${network_name}`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<PostingJobData>, error: Error) {
    const maxAttempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;

    const { post_id, review_id, network_name } = job.data;

    await this.prisma.reviewPlatformPost.update({
      where: { post_id },
      data: { status: 'failed', error_message: error.message },
    });

    console.log(`[PostingWorker] FAILED ${review_id} on ${network_name} after 3 attempts`);
  }
}
