// Production dependency license check and THIRD_PARTY_NOTICES.md generator (ADR-009, spec §85–87, §141).
//   node scripts/licenses.mjs           check, then rewrite THIRD_PARTY_NOTICES.md
//   node scripts/licenses.mjs --check   check only; exit 1 if anything is not allowed or the notices are stale
// This is a technical policy check, not legal advice.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTICES = path.join(ROOT, 'THIRD_PARTY_NOTICES.md');

/** Permissive licenses that may ship without further review. */
const ALLOWED = new Set([
  '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'CC-BY-4.0', 'CC0-1.0', 'ISC',
  'MIT', 'MIT-0', 'MIT/X11', 'PostgreSQL', 'Python-2.0', 'Unlicense', 'Zlib',
]);

/** Reviewed exceptions: package name pattern → why it may ship. */
const EXCEPTIONS = [
  {
    pattern: /^@img\/sharp-(libvips-)?[a-z0-9-]+$/,
    reason: 'Next.js image optimization. Prebuilt libvips (LGPL-3.0-or-later) is shipped as a separate, dynamically loaded library and is not modified.',
  },
];

function licenseOk(expr) {
  const e = expr.replace(/[()]/g, '').trim();
  if (e.includes(' OR ')) return e.split(' OR ').some((x) => licenseOk(x));
  if (e.includes(' AND ')) return e.split(' AND ').every((x) => licenseOk(x));
  return ALLOWED.has(e);
}

const raw = execSync('pnpm licenses list --prod --json', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const byLicense = JSON.parse(raw);

const packages = [];
const problems = [];
for (const [license, list] of Object.entries(byLicense)) {
  for (const p of list) {
    const exception = EXCEPTIONS.find((x) => x.pattern.test(p.name));
    if (!licenseOk(license) && !exception) problems.push(`${p.name}@${p.versions.join(',')}: ${license}`);
    // Reviewed exceptions are platform-specific binaries (different per OS); they are described below instead of
    // listed, so the file is the same wherever it is generated.
    if (!exception) packages.push({ name: p.name, versions: p.versions, license, homepage: p.homepage ?? '' });
  }
}

const unique = packages.sort((a, b) => a.name.localeCompare(b.name));
const counts = unique.reduce((m, p) => m.set(p.license, (m.get(p.license) ?? 0) + 1), new Map());
const lines = [
  '# Third-party notices',
  '',
  'Leadora AI ships these open-source packages in its production build (`pnpm licenses list --prod`).',
  "Each package's own license text and copyright notice ship with it inside the built images (`node_modules/<package>/`).",
  '',
  'Regenerate with `node scripts/licenses.mjs`. The check fails on any license outside the allowed set (ADR-009).',
  '',
  '## Summary',
  '',
  '| License | Packages |',
  '|---|---:|',
  ...[...counts].sort((a, b) => b[1] - a[1]).map(([l, n]) => `| ${l} | ${n} |`),
  '',
  '## Reviewed exceptions',
  '',
  ...EXCEPTIONS.map((x) => `- \`${x.pattern.source}\`: ${x.reason}`),
  '- `jszip` is dual-licensed `(MIT OR GPL-3.0-or-later)`; it is used under MIT.',
  '- `unzipper` is overridden to 0.12.3 (MIT): `exceljs` pins 0.10, which depends on `buffers`, a package with no license.',
  '',
  '## Packages',
  '',
  '| Package | Version | License | Homepage |',
  '|---|---|---|---|',
  ...unique.map((p) => `| ${p.name} | ${p.versions.join(', ')} | ${p.license} | ${p.homepage} |`),
  '',
];
const text = lines.join('\n');

if (problems.length) {
  console.error(`Licenses not allowed by ADR-009 (review, replace, or add a reasoned exception):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(NOTICES, 'utf8');
  } catch {
    // missing file is reported below
  }
  if (current.replace(/\r\n/g, '\n') !== text) {
    console.error('THIRD_PARTY_NOTICES.md is out of date: run `node scripts/licenses.mjs`.');
    process.exit(1);
  }
  console.log(`Licenses OK (${unique.length} packages); notices up to date.`);
} else {
  writeFileSync(NOTICES, text);
  console.log(`Licenses OK (${unique.length} packages); wrote THIRD_PARTY_NOTICES.md.`);
}
