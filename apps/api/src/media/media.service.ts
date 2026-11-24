import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type Media, type UploadTicket } from '@relay/shared';
import { randomUUID } from 'node:crypto';
import { trusted, type Model } from 'mongoose';
import { z } from 'zod';
import { models } from '../database/model-names.js';
import { type MessageDoc } from '../messages/message.schema.js';
import { type UploadDoc } from './upload.schema.js';
import { ENV, type Env } from '../config/environment.js';
import { ConversationMembershipService } from '../conversations/conversation-membership.service.js';
import { input } from './media.dto.js';
function inspectImage(mime: string, bytes: Uint8Array) {
  const data = Buffer.from(bytes);
  switch (mime) {
    case 'image/png':
      return data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    case 'image/jpeg':
      return data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
    case 'image/gif':
      return ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6));
    case 'image/webp':
      return data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
    default:
      return false;
  }
}

@Injectable()
export class MediaService {
  private readonly internal: S3Client;
  private readonly publicClient: S3Client;
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly membership: ConversationMembershipService,
    @InjectModel(models.upload) private readonly uploads: Model<UploadDoc>,
    @InjectModel(models.message) private readonly messages: Model<MessageDoc>,
  ) {
    const credentials = { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY };
    const config = {
      credentials,
      region: env.S3_REGION,
      forcePathStyle: true,
      maxAttempts: 2,
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
    };
    this.internal = new S3Client({ ...config, endpoint: env.S3_ENDPOINT });
    this.publicClient = new S3Client({ ...config, endpoint: env.S3_PUBLIC_ENDPOINT });
  }
  async health() {
    await this.internal.send(new HeadBucketCommand({ Bucket: this.env.S3_BUCKET }), {
      abortSignal: AbortSignal.timeout(2500),
    });
  }
  async upload(ownerId: string, body: z.infer<typeof input>): Promise<UploadTicket> {
    const { conversationId, ...media } = body;
    await this.membership.authorize(conversationId, ownerId);
    const key = `${ownerId}/${conversationId}/${randomUUID()}`;
    const headers = { 'content-type': media.mimeType, 'if-none-match': '*' };
    const url = await getSignedUrl(
      this.publicClient,
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        ContentType: media.mimeType,
        ContentLength: media.size,
        IfNoneMatch: '*',
      }),
      {
        expiresIn: 300,
        signableHeaders: new Set(['content-length', 'content-type', 'if-none-match']),
      },
    );
    await this.uploads.create({ ownerId, conversationId, media: { key, ...media } });
    return { key, url, headers };
  }
  async verified(
    ownerId: string,
    conversationId: string,
    key: string,
    type: 'image' | 'file',
  ): Promise<Media> {
    if (!key.startsWith(`${ownerId}/${conversationId}/`))
      throw new BadRequestException('Attachment does not belong to this chat');
    const ticket = await this.uploads.findOne({ ownerId, conversationId, 'media.key': key }).lean();
    if (!ticket) throw new BadRequestException('Upload ticket missing or expired');
    const params = { Bucket: this.env.S3_BUCKET, Key: key };
    try {
      const head = await this.internal.send(new HeadObjectCommand(params), {
        abortSignal: AbortSignal.timeout(3500),
      });
      const media = ticket.media;
      if (
        head.ContentLength !== media.size ||
        head.ContentType !== media.mimeType ||
        (type === 'image') !== media.mimeType.startsWith('image/')
      ) {
        throw new BadRequestException('Uploaded attachment does not match its ticket');
      }
      if (type === 'image') {
        const object = await this.internal.send(
          new GetObjectCommand({ ...params, Range: 'bytes=0-15' }),
          { abortSignal: AbortSignal.timeout(3500) },
        );
        if (!object.Body || !inspectImage(media.mimeType, await object.Body.transformToByteArray()))
          throw new BadRequestException('Invalid image content');
      }
      return media;
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
        throw new BadRequestException('Upload the attachment before sending');
      throw error;
    }
  }
  async download(userId: string, key: string) {
    const conversationId = key.split('/')[1];
    await this.membership.authorize(conversationId, userId);
    const message = await this.messages
      .findOne({
        conversationId,
        'media.key': key,
        deletedForEveryone: false,
        deletedFor: trusted({ $ne: userId }),
      })
      .lean();
    if (!message?.media) throw new NotFoundException('Attachment not found');
    const media = message.media;
    const name = encodeURIComponent(media.fileName).replace(
      /['()*]/g,
      (c) => '%' + c.charCodeAt(0).toString(16),
    );
    const url = await getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        ResponseContentType: media.mimeType,
        ResponseContentDisposition: `${message.type === 'image' ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
        ResponseCacheControl: 'private, max-age=60',
      }),
      { expiresIn: 120 },
    );
    return { url };
  }
}
