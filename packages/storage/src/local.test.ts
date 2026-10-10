import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { LocalStorage } from './local';
import { StorageError } from './provider';

let dir: string;
let storage: LocalStorage;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'leadora-storage-'));
  storage = new LocalStorage(dir);
});
after(() => rm(dir, { recursive: true, force: true }));

test('stores, reads and deletes by key', async () => {
  await storage.put('org/1/kb/doc/v1/file.txt', Buffer.from('hello'), 'text/plain');
  assert.equal((await storage.get('org/1/kb/doc/v1/file.txt')).toString(), 'hello');
  await storage.delete('org/1/kb/doc/v1/file.txt');
  await assert.rejects(storage.get('org/1/kb/doc/v1/file.txt'), (e: unknown) => e instanceof StorageError && e.code === 'NOT_FOUND');
  // Deleting again is fine.
  await storage.delete('org/1/kb/doc/v1/file.txt');
});

test('rejects keys that could escape the storage directory', async () => {
  for (const key of ['../etc/passwd', 'org/../../x', '/abs/path', 'org//x', 'org/./x', 'a\\b', '']) {
    await assert.rejects(storage.put(key, Buffer.from('x'), 'text/plain'), (e: unknown) => e instanceof StorageError && e.code === 'INVALID_KEY', key);
  }
});
