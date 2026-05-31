import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { POSTING_QUEUE, PostingJobData } from './posting.constants';

@Processor(POSTING_QUEUE)
export class PostingWorker extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(_job: Job<PostingJobData>): Promise<void> {
    throw new Error('No platforms currently support automatic posting');
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
