import { Job } from 'bullmq';
import { PostingWorker } from './posting.worker';
import { PrismaService } from '../prisma/prisma.service';
import { PostingJobData } from './posting.constants';

const JOB_DATA: PostingJobData = {
  post_id: 'post-uuid-1',
  review_id: 'review-uuid-1',
  network_id: 'net-uuid-1',
  network_name: 'Google',
  draft_text: 'Great place!',
  user_id: 'user-uuid-1',
  listing_id: 'listing-uuid-1',
};

function makeJob(data: PostingJobData, attemptsMade = 1): Job<PostingJobData> {
  return { data, opts: { attempts: 3 }, attemptsMade } as unknown as Job<PostingJobData>;
}

describe('PostingWorker', () => {
  let worker: PostingWorker;
  let prisma: {
    reviewPlatformPost: { update: jest.Mock };
    review: { update: jest.Mock };
    notification: { create: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      reviewPlatformPost: { update: jest.fn().mockResolvedValue({}) },
      review: { update: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
    };

    global.fetch = jest.fn();

    worker = new PostingWorker(prisma as unknown as PrismaService);
  });

  // ── process ──────────────────────────────────────────────────────────────────

  describe('process', () => {
    it('throws "No platforms currently support automatic posting"', async () => {
      await expect(worker.process(makeJob(JOB_DATA))).rejects.toThrow(
        'No platforms currently support automatic posting',
      );
    });

    it('does not call any external API', async () => {
      await worker.process(makeJob(JOB_DATA)).catch(() => {});
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does not write to the database when process throws', async () => {
      await worker.process(makeJob(JOB_DATA)).catch(() => {});
      expect(prisma.reviewPlatformPost.update).not.toHaveBeenCalled();
      expect(prisma.review.update).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  // ── onFailed ─────────────────────────────────────────────────────────────────

  describe('onFailed', () => {
    it('updates review_platform_posts to status "failed" on the final attempt', async () => {
      const error = new Error('connection timeout');
      // attemptsMade === attempts → final failure
      await worker.onFailed(makeJob(JOB_DATA, 3), error);

      expect(prisma.reviewPlatformPost.update).toHaveBeenCalledWith({
        where: { post_id: 'post-uuid-1' },
        data: { status: 'failed', error_message: 'connection timeout' },
      });
    });

    it('does NOT update the post when there are retries remaining', async () => {
      const error = new Error('transient error');
      // attemptsMade (1) < attempts (3) → still retrying
      await worker.onFailed(makeJob(JOB_DATA, 1), error);

      expect(prisma.reviewPlatformPost.update).not.toHaveBeenCalled();
    });
  });
});
