/**
 * A minimal Prometheus registry (spec §70): counters, gauges and histograms in the text exposition format.
 * Dependency-free on purpose — it is small, and avoids pulling extra peers into the database client's tree.
 */
type Labels = Record<string, string>;

const key = (labels: Labels) =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
    .join(',');

interface Metric {
  render(defaults: Labels): string;
}

class Series<V> {
  protected readonly values = new Map<string, { labels: Labels; value: V }>();
  protected entry(labels: Labels, init: () => V) {
    const k = key(labels);
    let e = this.values.get(k);
    if (!e) {
      e = { labels, value: init() };
      this.values.set(k, e);
    }
    return e;
  }
  reset() {
    this.values.clear();
  }
}

const fmt = (name: string, labels: Labels, value: number) => {
  const l = key(labels);
  return `${name}${l ? `{${l}}` : ''} ${Number.isFinite(value) ? value : 0}`;
};

export class Counter extends Series<number> implements Metric {
  constructor(
    private readonly name: string,
    private readonly help: string,
  ) {
    super();
  }
  inc(labels: Labels = {}, by = 1) {
    this.entry(labels, () => 0).value += by;
  }
  render(defaults: Labels) {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`, ...[...this.values.values()].map((e) => fmt(this.name, { ...defaults, ...e.labels }, e.value))].join('\n');
  }
}

export class Gauge extends Series<number> implements Metric {
  constructor(
    private readonly name: string,
    private readonly help: string,
  ) {
    super();
  }
  set(labels: Labels, value: number) {
    this.entry(labels, () => 0).value = value;
  }
  render(defaults: Labels) {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`, ...[...this.values.values()].map((e) => fmt(this.name, { ...defaults, ...e.labels }, e.value))].join('\n');
  }
}

export class Histogram extends Series<{ buckets: number[]; sum: number; count: number }> implements Metric {
  constructor(
    private readonly name: string,
    private readonly help: string,
    private readonly bounds: number[],
  ) {
    super();
  }
  observe(labels: Labels, value: number) {
    const e = this.entry(labels, () => ({ buckets: this.bounds.map(() => 0), sum: 0, count: 0 }));
    this.bounds.forEach((b, i) => {
      if (value <= b) e.value.buckets[i]! += 1;
    });
    e.value.sum += value;
    e.value.count += 1;
  }
  /** Returns a function that records the seconds elapsed since the timer started. */
  startTimer(labels: Labels = {}) {
    const start = process.hrtime.bigint();
    return (more: Labels = {}) => this.observe({ ...labels, ...more }, Number(process.hrtime.bigint() - start) / 1e9);
  }
  render(defaults: Labels) {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const e of this.values.values()) {
      const labels = { ...defaults, ...e.labels };
      this.bounds.forEach((b, i) => lines.push(fmt(`${this.name}_bucket`, { ...labels, le: String(b) }, e.value.buckets[i]!)));
      lines.push(fmt(`${this.name}_bucket`, { ...labels, le: '+Inf' }, e.value.count));
      lines.push(fmt(`${this.name}_sum`, labels, e.value.sum));
      lines.push(fmt(`${this.name}_count`, labels, e.value.count));
    }
    return lines.join('\n');
  }
}

export class MetricsRegistry {
  private readonly metrics: Metric[] = [];
  readonly contentType = 'text/plain; version=0.0.4; charset=utf-8';

  constructor(private readonly defaults: Labels) {}

  counter(name: string, help: string) {
    return this.add(new Counter(name, help));
  }
  gauge(name: string, help: string) {
    return this.add(new Gauge(name, help));
  }
  histogram(name: string, help: string, bounds: number[]) {
    return this.add(new Histogram(name, help, bounds));
  }

  private add<T extends Metric>(m: T): T {
    this.metrics.push(m);
    return m;
  }

  /** Process metrics plus everything registered. */
  render(): string {
    const mem = process.memoryUsage();
    const process_ = [
      '# TYPE process_resident_memory_bytes gauge',
      fmt('process_resident_memory_bytes', this.defaults, mem.rss),
      '# TYPE nodejs_heap_used_bytes gauge',
      fmt('nodejs_heap_used_bytes', this.defaults, mem.heapUsed),
      '# TYPE process_uptime_seconds gauge',
      fmt('process_uptime_seconds', this.defaults, process.uptime()),
    ];
    return `${[...process_, ...this.metrics.map((m) => m.render(this.defaults))].join('\n')}\n`;
  }
}
