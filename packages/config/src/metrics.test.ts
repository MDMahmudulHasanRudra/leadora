import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MetricsRegistry } from './metrics';

test('renders counters, gauges and histograms in the Prometheus text format', () => {
  const r = new MetricsRegistry({ service: 'api' });
  const c = r.counter('http_requests_total', 'Requests');
  const g = r.gauge('queue_jobs', 'Jobs');
  const h = r.histogram('latency_seconds', 'Latency', [0.1, 1]);
  c.inc({ route: '/leads', status: '2xx' });
  c.inc({ route: '/leads', status: '2xx' });
  g.set({ queue: 'imports' }, 3);
  h.observe({ route: '/leads' }, 0.05);
  h.observe({ route: '/leads' }, 0.5);
  const out = r.render();
  assert.match(out, /^http_requests_total\{route="\/leads",service="api",status="2xx"\} 2$/m);
  assert.match(out, /^queue_jobs\{queue="imports",service="api"\} 3$/m);
  assert.match(out, /^latency_seconds_bucket\{le="0\.1",route="\/leads",service="api"\} 1$/m);
  assert.match(out, /^latency_seconds_bucket\{le="\+Inf",route="\/leads",service="api"\} 2$/m);
  assert.match(out, /^latency_seconds_count\{route="\/leads",service="api"\} 2$/m);
  assert.match(out, /# TYPE latency_seconds histogram/);
});

test('escapes label values', () => {
  const r = new MetricsRegistry({});
  r.gauge('g', 'G').set({ v: 'a"b\\c' }, 1);
  assert.match(r.render(), /g\{v="a\\"b\\\\c"\} 1/);
});