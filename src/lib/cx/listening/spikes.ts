/**
 * Spike detection (pure): the current window's mention volume and negative-mention count are compared
 * with a trailing baseline of equal-length windows using a z-score. The standard deviation is floored at
 * sqrt(mean) and 1 (Poisson noise) so quiet brands don't trigger on one extra mention.
 */
export type SpikeSettings = { volumeZ: number; negativeZ: number; minMentions: number; baselineDays: number; windowHours: number };
export const DEFAULT_SPIKE_SETTINGS: SpikeSettings = { volumeZ: 3, negativeZ: 3, minMentions: 5, baselineDays: 14, windowHours: 24 };

export type Bucket = { start: string; end: string; total: number; negative: number };
export type ZStat = { value: number; mean: number; sd: number; z: number; triggered: boolean };
export type SpikeResult = {
  ready: boolean;
  reason?: string;
  window: { start: string; end: string };
  baselineWindows: number;
  volume: ZStat;
  negative: ZStat;
  triggered: boolean;
  kind: "volume" | "negative" | "both" | null;
  severity: "warning" | "critical" | null;
};

/** Split [now - (baselineWindows+1)*window, now] into equal windows, oldest first; the last is current. */
export function bucketize(mentions: { published_at: string | null; sentiment: string | null }[], now: Date, windowHours: number, baselineWindows: number, dataSince?: Date | null): Bucket[] {
  const w = windowHours * 3600_000;
  const end = now.getTime();
  const n = baselineWindows + 1;
  const buckets: Bucket[] = Array.from({ length: n }, (_, i) => {
    const s = end - (n - i) * w;
    return { start: new Date(s).toISOString(), end: new Date(s + w).toISOString(), total: 0, negative: 0 };
  });
  const first = end - n * w;
  for (const m of mentions) {
    if (!m.published_at) continue;
    const t = new Date(m.published_at).getTime();
    if (!(t > first && t <= end)) continue;
    const i = Math.min(n - 1, Math.floor((t - first) / w));
    buckets[i].total++;
    if (m.sentiment === "negative") buckets[i].negative++;
  }
  // Windows that start before complete coverage are unknown, not zero.
  if (dataSince) return buckets.filter((b, i) => i === n - 1 || new Date(b.start).getTime() >= dataSince.getTime());
  return buckets;
}

export function zScore(value: number, baseline: number[]): { mean: number; sd: number; z: number } {
  if (!baseline.length) return { mean: 0, sd: 0, z: 0 };
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance = baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length;
  const sd = Math.max(Math.sqrt(variance), Math.sqrt(mean), 1);
  return { mean, sd, z: (value - mean) / sd };
}

export const MIN_BASELINE_WINDOWS = 3;

export function detectSpike(buckets: Bucket[], s: SpikeSettings): SpikeResult {
  const current = buckets[buckets.length - 1] ?? { start: new Date().toISOString(), end: new Date().toISOString(), total: 0, negative: 0 };
  const base = buckets.slice(0, -1);
  const v = zScore(current.total, base.map((b) => b.total));
  const n = zScore(current.negative, base.map((b) => b.negative));
  const ready = base.length >= MIN_BASELINE_WINDOWS;
  const volume: ZStat = { value: current.total, ...v, triggered: ready && current.total >= s.minMentions && v.z >= s.volumeZ };
  const negative: ZStat = { value: current.negative, ...n, triggered: ready && current.negative >= Math.max(2, Math.ceil(s.minMentions / 2)) && n.z >= s.negativeZ };
  const triggered = volume.triggered || negative.triggered;
  const kind = volume.triggered && negative.triggered ? "both" : volume.triggered ? "volume" : negative.triggered ? "negative" : null;
  const critical = (volume.triggered && v.z >= s.volumeZ * 2) || (negative.triggered && n.z >= s.negativeZ * 1.5) || kind === "both";
  return {
    ready,
    reason: ready ? undefined : `Needs at least ${MIN_BASELINE_WINDOWS} baseline windows of data (has ${base.length}).`,
    window: { start: current.start, end: current.end },
    baselineWindows: base.length,
    volume,
    negative,
    triggered,
    kind,
    severity: triggered ? (critical ? "critical" : "warning") : null,
  };
}
