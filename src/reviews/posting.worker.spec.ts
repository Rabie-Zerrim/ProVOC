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
    worker = new PostingWorker(prisma as unknown as PrismaService);
  });

  // ── process (success path) ───────────────────────────────────────────────────

  describe('process', () => {
    it('updates review_platform_posts with status "simulated", posted_at, and a SIMULATED- external_review_id', async () => {
      await worker.process(makeJob(JOB_DATA));

      expect(prisma.reviewPlatformPost.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { post_id: 'post-uuid-1' },
          data: expect.objectContaining({
            status: 'simulated',
            platform_specific_text: 'Great place!',
            posted_at: expect.any(Date),
            external_review_id: expect.stringMatching(/^SIMULATED-/),
          }),
        }),
      );
    });

    it('updates the parent review status to "published"', async () => {
      await worker.process(makeJob(JOB_DATA));

      expect(prisma.review.update).toHaveBeenCalledWith({
        where: { review_id: 'review-uuid-1' },
        data: { status: 'published' },
      });
    });

    it('creates a notification row with correct fields after posting', async () => {
      await worker.process(makeJob(JOB_DATA));

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'user-uuid-1',
            type: 'posting',
            category: 'review',
            title: 'Review submitted',
            body: 'Your review was submitted to Google',
            is_sent: true,
            sent_at: expect.any(Date),
          }),
        }),
      );
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
