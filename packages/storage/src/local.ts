import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertValidKey, StorageError, type StorageProvider } from './provider';

/** Development and single-node installs: files under one directory (a Docker volume in Compose). */
export class LocalStorage implements StorageProvider {
  readonly name = 'local';
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  private resolve(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new StorageError('INVALID_KEY', 'Invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    // Write-then-rename would be atomic, but keys are write-once (versioned), so a plain write is enough.
    await writeFile(file, body);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new StorageError('NOT_FOUND', 'File not found');
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
