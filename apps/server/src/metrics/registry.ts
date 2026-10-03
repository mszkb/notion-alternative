/**
 * Minimal Prometheus registry (text exposition format 0.0.4).
 *
 * Kept dependency-free on purpose (no prom-client, see ADR 0007). Labels must
 * have low cardinality and never carry personal data or content: use route
 * templates, status codes and fixed enums only, never e-mails, IDs or paths.
 */

type Labels = Record<string, string>

interface Metric {
  render(): string[]
}

function labelKey(labels: Labels): string {
  return JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)))
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')
}

function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return ''
  return `{${entries.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(',')}}`
}

function formatValue(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return '+Inf'
  if (value === -Infinity) return '-Inf'
  return String(value)
}

function header(name: string, help: string, type: string): string[] {
  return [
    `# HELP ${name} ${help.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}`,
    `# TYPE ${name} ${type}`,
  ]
}

export class Counter implements Metric {
  private readonly series = new Map<string, { labels: Labels; value: number }>()

  constructor(
    readonly name: string,
    private readonly help: string,
  ) {}

  inc(labels: Labels = {}, value = 1): void {
    if (value < 0) throw new Error('counter can only increase')
    const key = labelKey(labels)
    const entry = this.series.get(key)
    if (entry) entry.value += value
    else this.series.set(key, { labels: { ...labels }, value })
  }

  render(): string[] {
    const lines = header(this.name, this.help, 'counter')
    for (const { labels, value } of this.series.values()) {
      lines.push(`${this.name}${formatLabels(labels)} ${formatValue(value)}`)
    }
    return lines
  }
}

export class Gauge implements Metric {
  private readonly series = new Map<string, { labels: Labels; value: number }>()

  /** `collect` runs on every scrape to refresh values that are read on demand. */
  constructor(
    readonly name: string,
    private readonly help: string,
    private readonly collect?: (gauge: Gauge) => void,
  ) {}

  set(value: number, labels: Labels = {}): void {
    this.series.set(labelKey(labels), { labels: { ...labels }, value })
  }

  render(): string[] {
    this.collect?.(this)
    const lines = header(this.name, this.help, 'gauge')
    for (const { labels, value } of this.series.values()) {
      lines.push(`${this.name}${formatLabels(labels)} ${formatValue(value)}`)
    }
    return lines
  }
}

export class Histogram implements Metric {
  private readonly series = new Map<
    string,
    { labels: Labels; counts: number[]; sum: number; count: number }
  >()

  constructor(
    readonly name: string,
    private readonly help: string,
    private readonly buckets: number[],
  ) {
    this.buckets = [...buckets].sort((a, b) => a - b)
  }

  observe(labels: Labels, value: number): void {
    const key = labelKey(labels)
    let entry = this.series.get(key)
    if (!entry) {
      entry = { labels: { ...labels }, counts: this.buckets.map(() => 0), sum: 0, count: 0 }
      this.series.set(key, entry)
    }
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]!) entry.counts[i]!++
    }
    entry.sum += value
    entry.count++
  }

  render(): string[] {
    const lines = header(this.name, this.help, 'histogram')
    for (const { labels, counts, sum, count } of this.series.values()) {
      this.buckets.forEach((le, i) => {
        lines.push(
          `${this.name}_bucket${formatLabels({ ...labels, le: formatValue(le) })} ${counts[i]}`,
        )
      })
      lines.push(`${this.name}_bucket${formatLabels({ ...labels, le: '+Inf' })} ${count}`)
      lines.push(`${this.name}_sum${formatLabels(labels)} ${formatValue(sum)}`)
      lines.push(`${this.name}_count${formatLabels(labels)} ${count}`)
    }
    return lines
  }
}

export class Registry {
  private readonly metrics = new Map<string, Metric>()

  private add<T extends Metric & { name: string }>(metric: T): T {
    if (this.metrics.has(metric.name)) throw new Error(`metric ${metric.name} already registered`)
    this.metrics.set(metric.name, metric)
    return metric
  }

  counter(name: string, help: string): Counter {
    return this.add(new Counter(name, help))
  }

  gauge(name: string, help: string, collect?: (gauge: Gauge) => void): Gauge {
    return this.add(new Gauge(name, help, collect))
  }

  histogram(name: string, help: string, buckets: number[]): Histogram {
    return this.add(new Histogram(name, help, buckets))
  }

  render(): string {
    return [...this.metrics.values()].flatMap((m) => m.render()).join('\n') + '\n'
  }
}

export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'
