export interface LeadImportJob {
  data: { importId: string };
  attemptsMade: number;
  opts: { attempts?: number };
}

export interface LeadImportDeps {
  process: (importId: string) => Promise<void>;
  markFailed: (importId: string, message: string) => Promise<void>;
}

/** Retries are safe (the processor resumes from its checkpoint); after the last one, surface the failure to users. */
export async function handleLeadImport(deps: LeadImportDeps, job: LeadImportJob): Promise<void> {
  try {
    await deps.process(job.data.importId);
  } catch (err) {
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      await deps.markFailed(job.data.importId, 'Import failed after several attempts. Try uploading the file again.');
    }
    throw err;
  }
}
