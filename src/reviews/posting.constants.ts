export const POSTING_QUEUE = 'review-posting';

export interface PostingJobData {
  post_id: string;
  review_id: string;
  network_id: string;
  network_name: string;
  draft_text: string;
  user_id: string;
  listing_id: string | null;
}
