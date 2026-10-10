// Runs autocannon in its own process so the load generator does not share the event loop with the API under test.
// Input (a JSON file named by argv[2]): { url, connections, duration, overallRate?, headers, method?, body?, paths? }
//   body may contain "{n}", replaced by a per-request counter; paths (if given) are used round-robin.
// Output (stdout, JSON): the autocannon result.
import { readFileSync } from 'node:fs';
import autocannon from 'autocannon';

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let n = 0;
const request = {
  method: spec.method ?? 'GET',
  setupRequest: (req) => {
    const i = n++;
    const next = { ...req };
    if (spec.paths) next.path = spec.paths[i % spec.paths.length];
    if (spec.body) next.body = spec.body.replaceAll('{n}', String(i));
    return next;
  },
};

const result = await autocannon({
  url: spec.url,
  connections: spec.connections,
  duration: spec.duration,
  overallRate: spec.overallRate,
  headers: spec.headers,
  requests: [request],
});
process.stdout.write(JSON.stringify(result));
