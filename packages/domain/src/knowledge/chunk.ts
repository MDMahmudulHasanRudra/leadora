import type { TextSection } from './parse';

export interface Chunk {
  ordinal: number;
  content: string;
  page: number | null;
  section: string | null;
}

/**
 * Splits sections into ~targetChars chunks on paragraph, then sentence, then word boundaries, with a small
 * overlap so a fact split across a boundary is still retrievable. Chunks never span two pages or headings,
 * which keeps citations exact.
 */
export function chunkSections(sections: TextSection[], opts: { targetChars?: number; overlapChars?: number } = {}): Chunk[] {
  const target = opts.targetChars ?? 3000;
  const overlap = opts.overlapChars ?? 300;
  const chunks: Chunk[] = [];

  for (const s of sections) {
    const text = s.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) continue;
    // Pieces no longer than the target: paragraphs, else sentences, else hard word windows.
    const pieces: string[] = [];
    for (const para of text.split(/\n\s*\n/)) {
      if (para.length <= target) {
        pieces.push(para);
        continue;
      }
      for (const sentence of para.split(/(?<=[.!?।])\s+/)) {
        if (sentence.length <= target) pieces.push(sentence);
        else for (let i = 0; i < sentence.length; i += target) pieces.push(sentence.slice(i, i + target));
      }
    }

    let current = '';
    const emit = () => {
      if (!current.trim()) return;
      chunks.push({ ordinal: chunks.length, content: current.trim(), page: s.page ?? null, section: s.heading ?? null });
      // Carry the tail of this chunk into the next one, starting at a word boundary.
      const tail = current.slice(-overlap);
      current = overlap > 0 && current.length > overlap ? tail.slice(tail.indexOf(' ') + 1) : '';
    };
    for (const piece of pieces) {
      if (current && current.length + piece.length + 2 > target) emit();
      current = current ? `${current}\n\n${piece}` : piece;
    }
    // `current` is per section, so a section's overlap never leaks into the next one.
    emit();
  }
  return chunks;
}
