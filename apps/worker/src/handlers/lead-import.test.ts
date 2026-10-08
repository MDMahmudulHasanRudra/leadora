import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleLeadImport } from './lead-import';

const job = (attemptsMade: number, attempts = 4) => ({ data: { importId: 'imp-1' }, attemptsMade, opts: { attempts } });

test('processes the import named in the job', async () => {
  const seen: string[] = [];
  await handleLeadImport({ process: async (id) => void seen.push(id), markFailed: async () => assert.fail() }, job(0));
  assert.deepEqual(seen, ['imp-1']);
});

test('rethrows without marking failed while retries remain', async () => {
  let marked = false;
  await assert.rejects(
    handleLeadImport({ process: async () => Promise.reject(new Error('db down')), markFailed: async () => void (marked = true) }, job(1)),
    /db down/,
  );
  assert.equal(marked, false);
});

test('marks the import failed on the last attempt', async () => {
  const marked: [string, string][] = [];
  await assert.rejects(
    handleLeadImport(
      { process: async () => Promise.reject(new Error('db down')), markFailed: async (id, msg) => void marked.push([id, msg]) },
      job(3),
    ),
  );
  assert.deepEqual(marked, [['imp-1', 'Import failed after several attempts. Try uploading the file again.']]);
});
