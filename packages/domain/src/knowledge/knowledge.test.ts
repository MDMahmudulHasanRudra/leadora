import assert from 'node:assert/strict';
import type { LookupAddress } from 'node:dns';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { DomainError } from '../errors';
import { chunkSections } from './chunk';
import { detectFileType } from './detect';
import { extractSections } from './parse';
import { assertFetchableUrl, guardedLookup, isPublicAddress, robotsAllows, safeFetch } from './safe-fetch';

const MB = 1_048_576;
const code = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;

test('file detection requires extension, MIME and content signature to agree', () => {
  assert.deepEqual(detectFileType(Buffer.from('%PDF-1.7 ...'), 'Price List.PDF', 'application/pdf', MB), { kind: 'pdf', mimeType: 'application/pdf' });
  assert.equal(detectFileType(Buffer.from('# Hi'), 'notes.md', 'application/octet-stream', MB).kind, 'markdown');
  assert.equal(detectFileType(Buffer.from('দাম ১২০ টাকা'), 'bn.txt', 'text/plain', MB).kind, 'text');
  // An HTML page or executable renamed to .pdf is rejected.
  assert.throws(() => detectFileType(Buffer.from('<html>'), 'x.pdf', 'application/pdf', MB), code('FILE_TYPE_MISMATCH'));
  assert.throws(() => detectFileType(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), 'x.txt', 'text/plain', MB), code('FILE_TYPE_MISMATCH'));
  assert.throws(() => detectFileType(Buffer.from('%PDF-'), 'x.pdf', 'text/html', MB), code('FILE_TYPE_MISMATCH'));
  assert.throws(() => detectFileType(Buffer.from('x'), 'x.exe', 'application/octet-stream', MB), code('UNSUPPORTED_FILE'));
  assert.throws(() => detectFileType(Buffer.alloc(11, 'a'), 'big.txt', 'text/plain', 10), code('FILE_TOO_LARGE'));
  assert.throws(() => detectFileType(Buffer.alloc(0), 'e.txt', 'text/plain', MB), code('EMPTY_FILE'));
});

test('markdown keeps headings as sections', async () => {
  const sections = await extractSections(Buffer.from('Intro line\n\n# Pricing\nBlue model: 120 BDT\n\n## Delivery\nDhaka in 2 days'), 'markdown');
  assert.deepEqual(sections, [
    { text: 'Intro line' },
    { text: 'Blue model: 120 BDT', heading: 'Pricing' },
    { text: 'Dhaka in 2 days', heading: 'Delivery' },
  ]);
});

/** A minimal valid PDF with one text line per page, built by hand so tests need no fixtures. */
function makePdf(pages: string[]): Buffer {
  const objs: string[] = [];
  const pageIds = pages.map((_, i) => 3 + i * 2);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  const fontId = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    const stream = `BT /F1 14 Tf 20 100 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
    objs[pageIds[i]!] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 144] /Contents ${pageIds[i]! + 1} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    objs[pageIds[i]! + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objs[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = Buffer.byteLength(out);
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test('PDF text is extracted per page', async () => {
  const sections = await extractSections(makePdf(['Blue model costs 120 BDT', 'Delivery takes two days']), 'pdf');
  assert.deepEqual(sections, [
    { text: 'Blue model costs 120 BDT', page: 1 },
    { text: 'Delivery takes two days', page: 2 },
  ]);
});

test('chunks stay under the target size, overlap, and never cross sections', () => {
  const para = (n: number) => `Paragraph ${n}. ` + 'word '.repeat(150);
  const chunks = chunkSections(
    [
      { text: [1, 2, 3, 4, 5, 6].map(para).join('\n\n'), page: 1 },
      { text: 'Short page two.', page: 2 },
    ],
    { targetChars: 2000, overlapChars: 200 },
  );
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.content.length <= 2000 + 200));
  assert.deepEqual(chunks.map((c) => c.ordinal), chunks.map((_, i) => i));
  const last = chunks.at(-1)!;
  assert.deepEqual(last, { ordinal: chunks.length - 1, content: 'Short page two.', page: 2, section: null });
  // Overlap: the second chunk starts with text from the end of the first.
  assert.ok(chunks[0]!.content.endsWith(chunks[1]!.content.slice(0, 40).trim()) || chunks[0]!.content.includes(chunks[1]!.content.slice(0, 40)));
});

test('only public addresses are fetchable', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(a), false, a);
  }
  for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicAddress(a), true, a);

  assert.throws(() => assertFetchableUrl('file:///etc/passwd'), code('URL_NOT_ALLOWED'));
  assert.throws(() => assertFetchableUrl('http://user:pw@example.com/'), code('URL_NOT_ALLOWED'));
  assert.throws(() => assertFetchableUrl('http://169.254.169.254/latest/meta-data'), code('URL_NOT_ALLOWED'));
  assert.throws(() => assertFetchableUrl('http://[::1]/'), code('URL_NOT_ALLOWED'));
  assert.throws(() => assertFetchableUrl('http://example.com:6379/'), code('URL_NOT_ALLOWED'));
  assert.equal(assertFetchableUrl('https://example.com/pricing').hostname, 'example.com');
});

test('hostnames that resolve to private addresses are refused at connect time', async () => {
  const fake = ((_h: string, _o: object, cb: (e: Error | null, a: LookupAddress[]) => void) =>
    cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }])) as never;
  await new Promise<void>((resolve) => {
    guardedLookup(fake)('rebind.example', { all: true }, (err) => {
      assert.ok(err instanceof DomainError && err.code === 'URL_NOT_ALLOWED');
      resolve();
    });
  });
  // A real request to localhost never connects.
  await assert.rejects(safeFetch('http://localhost/'), code('URL_NOT_ALLOWED'));
});

test('redirects are re-checked and size is capped', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }).end();
    else if (req.url === '/big') res.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(5000));
    else res.writeHead(200, { 'content-type': 'text/html' }).end('<p>Hello</p>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  // Test-only resolver that maps "site.test" to the local server, standing in for a public host.
  const lookup = ((_h: string, o: { all?: boolean }, cb: (e: Error | null, a: string | LookupAddress[], f?: number) => void) =>
    o.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)) as never;
  const base = `http://site.test:${port}`;
  const opts = { lookup, ports: [String(port)], maxBytes: 1000 };
  try {
    const page = await safeFetch(`${base}/`, opts);
    assert.equal(page.body.toString(), '<p>Hello</p>');
    assert.match(page.contentType, /text\/html/);
    await assert.rejects(safeFetch(`${base}/redirect`, opts), code('URL_NOT_ALLOWED'));
    await assert.rejects(safeFetch(`${base}/big`, opts), code('URL_TOO_LARGE'));
  } finally {
    server.close();
  }
});

test('robots.txt is honoured for our agent and for *', () => {
  const robots = 'User-agent: *\nDisallow: /private\nAllow: /private/pricing\n\nUser-agent: BadBot\nDisallow: /';
  assert.equal(robotsAllows(robots, '/pricing'), true);
  assert.equal(robotsAllows(robots, '/private/team'), false);
  assert.equal(robotsAllows(robots, '/private/pricing'), true);
  assert.equal(robotsAllows('User-agent: LeadoraBot\nDisallow: /\n\nUser-agent: *\nAllow: /', '/x'), false);
  assert.equal(robotsAllows('', '/anything'), true);
});
