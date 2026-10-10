import { LocalStorage } from './local';
import type { StorageProvider } from './provider';
import { S3Storage } from './s3';

export * from './provider';
export { LocalStorage } from './local';
export { S3Storage, type S3Options } from './s3';

export interface StorageConfig {
  STORAGE_DRIVER: 'local' | 's3';
  STORAGE_LOCAL_DIR: string;
  STORAGE_BUCKET: string;
  STORAGE_REGION: string;
  STORAGE_ENDPOINT: string;
  STORAGE_ACCESS_KEY: string;
  STORAGE_SECRET_KEY: string;
  STORAGE_FORCE_PATH_STYLE: boolean;
}

export function createStorage(env: StorageConfig): StorageProvider {
  if (env.STORAGE_DRIVER === 'local') return new LocalStorage(env.STORAGE_LOCAL_DIR);
  return new S3Storage({
    bucket: env.STORAGE_BUCKET,
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT || undefined,
    accessKeyId: env.STORAGE_ACCESS_KEY || undefined,
    secretAccessKey: env.STORAGE_SECRET_KEY || undefined,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
  });
}
