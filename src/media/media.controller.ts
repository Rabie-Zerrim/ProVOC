import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiConsumes,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MediaService } from './media.service';

@ApiTags('media')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('reviews')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post(':id/media')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
          return cb(new BadRequestException('Only JPEG and PNG images are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a photo for a review' })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo'],
      properties: {
        photo: {
          type: 'string',
          format: 'binary',
          description: 'JPEG or PNG image, max 5MB',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Photo uploaded successfully',
    schema: {
      properties: {
        media_id: { type: 'string', format: 'uuid' },
        url: { type: 'string', description: 'Presigned S3 GET URL (1 hour expiry)' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'File missing or unsupported type' })
  @ApiNotFoundResponse({ description: 'Review not found' })
  uploadPhoto(
    @Request() req,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Photo file is required');
    return this.mediaService.uploadReviewPhoto(id, req.user.user_id, file);
  }

  @Get(':id/media')
  @ApiOperation({ summary: 'Get all media for a review' })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiOkResponse({
    description: 'List of media with presigned GET URLs (1 hour expiry)',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          media_id: { type: 'string', format: 'uuid' },
          url: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Review not found' })
  getMedias(@Request() req, @Param('id') id: string) {
    return this.mediaService.getReviewMedias(id, req.user.user_id);
  }

  @Delete(':id/media/:mediaId')
  @ApiOperation({ summary: 'Delete a media file for a review' })
  @ApiParam({ name: 'id', description: 'Review UUID' })
  @ApiParam({ name: 'mediaId', description: 'Media UUID' })
  @ApiOkResponse({
    description: 'Media deleted successfully',
    schema: { properties: { success: { type: 'boolean', example: true } } },
  })
  @ApiNotFoundResponse({ description: 'Media not found' })
  @ApiForbiddenResponse({ description: 'Media belongs to another user' })
  deleteMedia(
    @Request() req,
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
  ) {
    return this.mediaService.deleteReviewMedia(id, mediaId, req.user.user_id);
  }
}
