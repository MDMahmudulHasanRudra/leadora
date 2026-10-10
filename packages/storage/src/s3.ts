import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { assertValidKey, StorageError, type StorageProvider } from './provider';

export interface S3Options {
  bucket: string;
  region: string;
  /** Any S3-compatible endpoint (AWS, Cloudflare R2, Backblaze, Wasabi, a self-hosted gateway…). */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

export class S3Storage implements StorageProvider {
  readonly name = 's3';
  private readonly client: S3Client;

  constructor(private readonly opts: S3Options) {
    this.client = new S3Client({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      forcePathStyle: opts.forcePathStyle ?? false,
      ...(opts.accessKeyId && opts.secretAccessKey ? { credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } } : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertValidKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer> {
    assertValidKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      if (err instanceof NoSuchKey) throw new StorageError('NOT_FOUND', 'File not found');
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }
}
