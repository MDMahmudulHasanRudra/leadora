import { convert } from 'html-to-text';
import { DomainError } from '../errors';
import type { DocumentKind } from './detect';

/** A run of text with where it came from, so chunks can cite a page or heading (spec §34). */
export interface TextSection {
  text: string;
  page?: number;
  heading?: string;
}

export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'nav', format: 'skip' },
      { selector: 'footer', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
    ],
  });
}

/** Markdown: one section per heading, so chunks carry the heading they belong to. */
function markdownSections(text: string): TextSection[] {
  const sections: TextSection[] = [];
  let heading: string | undefined;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) sections.push({ text: body, ...(heading ? { heading } : {}) });
    buf = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) {
      flush();
      heading = m[1]!.trim();
    } else buf.push(line);
  }
  flush();
  return sections;
}

export async function extractSections(buf: Buffer, kind: DocumentKind): Promise<TextSection[]> {
  try {
    switch (kind) {
      case 'pdf': {
        // unpdf is ESM-only; a dynamic import keeps this package loadable from CommonJS.
        const { extractText, getDocumentProxy } = await import('unpdf');
        const pdf = await getDocumentProxy(new Uint8Array(buf));
        const { text } = await extractText(pdf, { mergePages: false });
        return text.map((t, i) => ({ text: t.trim(), page: i + 1 })).filter((s) => s.text);
      }
      case 'docx': {
        const mammoth = await import('mammoth');
        const { value } = await mammoth.extractRawText({ buffer: buf });
        return [{ text: value.trim() }].filter((s) => s.text);
      }
      case 'markdown':
        return markdownSections(buf.toString('utf8'));
      case 'html':
        return [{ text: htmlToText(buf.toString('utf8')).trim() }].filter((s) => s.text);
      case 'text':
      case 'csv':
        return [{ text: buf.toString('utf8').trim() }].filter((s) => s.text);
    }
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new DomainError('invalid', 'UNREADABLE_FILE', `The file could not be read: ${(err as Error).message.slice(0, 200)}`);
  }
}
