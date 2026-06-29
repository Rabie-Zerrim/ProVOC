import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MediaService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.s3 = new S3Client({
      region: this.config.get<string>('AWS_REGION'),
      credentials: {
        accessKeyId: this.config.get<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.config.get<string>('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = this.config.get<string>('AWS_S3_BUCKET');
  }

  async uploadReviewPhoto(reviewId: string, userId: string, file: Express.Multer.File) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: reviewId, user_id: userId, deleted_at: null },
    });
    if (!review) throw new NotFoundException('Review not found');

    const ext = file.mimetype === 'image/png' ? 'png' : 'jpg';
    const key = `reviews/${reviewId}/${uuidv4()}.${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    const media = await this.prisma.reviewMedia.create({
      data: {
        review_id: reviewId,
        media_type: 'image',
        s3_key: key,
        original_filename: file.originalname,
        file_size_bytes: file.size,
        mime_type: file.mimetype,
      },
    });

    const url = await this.getPresignedUrl(key);
    return { media_id: media.media_id, url };
  }

  async getReviewMedias(reviewId: string, userId: string) {
    const review = await this.prisma.review.findFirst({
      where: { review_id: reviewId, user_id: userId, deleted_at: null },
    });
    if (!review) throw new NotFoundException('Review not found');

    const medias = await this.prisma.reviewMedia.findMany({
      where: { review_id: reviewId },
      orderBy: { created_at: 'asc' },
    });

    return Promise.all(
      medias.map(async (m) => ({
        media_id: m.media_id,
        url: await this.getPresignedUrl(m.s3_key),
        created_at: m.created_at,
      })),
    );
  }

  async deleteReviewMedia(reviewId: string, mediaId: string, userId: string) {
    const media = await this.prisma.reviewMedia.findFirst({
      where: { media_id: mediaId, review_id: reviewId },
      include: { review: { select: { user_id: true } } },
    });
    if (!media) throw new NotFoundException('Media not found');
    if (media.review.user_id !== userId) throw new ForbiddenException('Access denied');

    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: media.s3_key }),
    );
    await this.prisma.reviewMedia.delete({ where: { media_id: mediaId } });

    return { success: true };
  }

  private async getPresignedUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 3600 },
    );
  }
}
