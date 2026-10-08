import { DomainError } from '../errors';

export type DocumentKind = 'pdf' | 'docx' | 'text' | 'markdown' | 'csv' | 'html';

const BY_EXTENSION: Record<string, { kind: DocumentKind; mime: string; declared: string[] }> = {
  pdf: { kind: 'pdf', mime: 'application/pdf', declared: ['application/pdf'] },
  docx: {
    kind: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    declared: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
  },
  txt: { kind: 'text', mime: 'text/plain', declared: ['text/plain'] },
  md: { kind: 'markdown', mime: 'text/markdown', declared: ['text/markdown', 'text/x-markdown', 'text/plain'] },
  markdown: { kind: 'markdown', mime: 'text/markdown', declared: ['text/markdown', 'text/x-markdown', 'text/plain'] },
  csv: { kind: 'csv', mime: 'text/csv', declared: ['text/csv', 'application/vnd.ms-excel', 'text/plain'] },
};

export const ALLOWED_EXTENSIONS = Object.keys(BY_EXTENSION);

const startsWith = (buf: Buffer, sig: number[]) => sig.every((b, i) => buf[i] === b);

/** Text must be valid UTF-8 without NUL bytes; anything else is binary pretending to be text. */
function isUtf8Text(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spec §55: extension, declared MIME, size and content signature must all agree.
 * Browsers send `application/octet-stream` for unknown types, so that declared type is tolerated.
 */
export function detectFileType(buf: Buffer, fileName: string, declaredMime: string, maxBytes: number): { kind: DocumentKind; mimeType: string } {
  if (buf.length === 0) throw new DomainError('invalid', 'EMPTY_FILE', 'The file is empty');
  if (buf.length > maxBytes) throw new DomainError('invalid', 'FILE_TOO_LARGE', `Files can be at most ${Math.round(maxBytes / 1_048_576)} MB`);
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const type = BY_EXTENSION[ext];
  if (!type) throw new DomainError('invalid', 'UNSUPPORTED_FILE', `Supported files: ${ALLOWED_EXTENSIONS.join(', ')}`);
  const declared = declaredMime.split(';')[0]!.trim().toLowerCase();
  if (declared && declared !== 'application/octet-stream' && !type.declared.includes(declared)) {
    throw new DomainError('invalid', 'FILE_TYPE_MISMATCH', 'The file type does not match its extension');
  }
  const signatureOk =
    type.kind === 'pdf'
      ? startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
      : type.kind === 'docx'
        ? startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) // ZIP container
        : isUtf8Text(buf);
  if (!signatureOk) throw new DomainError('invalid', 'FILE_TYPE_MISMATCH', 'The file content does not match its extension');
  return { kind: type.kind, mimeType: type.mime };
}
