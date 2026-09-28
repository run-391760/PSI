/**
 * Crisis v2 math (pure, fixture-tested): risk score and recovery against the pre-crisis baseline.
 */

/**
 * Risk score 0–100 = geometric mean of three factors, each 0–1:
 *  - velocity   = 1 − e^(−max(0, volume z) / 3)          (how fast volume is rising vs its baseline)
 *  - negativity = 0.2 + 0.8 × negative share              (a neutral spike still carries some risk)
 *  - reach      = log10(1 + reach) / 6 when follower reach is known (1M ≈ 1), else log10(1 + mentions) / 3
 */
export function riskScore(input: { volumeZ: number | null | undefined; negative: number; mentions: number; reach: number | null }) {
  const z = Number.isFinite(input.volumeZ ?? NaN) ? (input.volumeZ as number) : 0;
  const velocity = 1 - Math.exp(-Math.max(0, z) / 3);
  const negShare = input.mentions ? input.negative / input.mentions : 0;
  const negativity = 0.2 + 0.8 * Math.min(1, Math.max(0, negShare));
  const reachF = input.reach != null ? Math.min(1, Math.log10(1 + input.reach) / 6) : Math.min(1, Math.log10(1 + input.mentions) / 3);
  const score = input.mentions ? Math.round(100 * Math.cbrt(velocity * negativity * reachF)) : 0;
  return { score, band: score >= 70 ? "high" : score >= 40 ? "elevated" : "low", velocity, negativity, reach: reachF, reachKnown: input.reach != null } as const;
}
export type Risk = ReturnType<typeof riskScore>;

export type DayCount = { date: string; total: number; negative: number };

/**
 * Recovery after a crisis start: daily volume index (baseline = 100) and negative share, with milestones
 * at +30/+60/+90 days using the trailing 7-day average. A milestone is null until that day has passed.
 * Recovered = volume ≤ 125% of baseline and negative share ≤ baseline + 5 points.
 */
export function recoveryCurve(daily: DayCount[], eventStart: string, now: Date, baselineDays = 14) {
  const start = eventStart.slice(0, 10);
  const before = daily.filter((d) => d.date < start).slice(-baselineDays);
  const bVol = before.length ? before.reduce((a, d) => a + d.total, 0) / before.length : null;
  const bNegTotal = before.reduce((a, d) => a + d.total, 0);
  const bNeg = bNegTotal ? before.reduce((a, d) => a + d.negative, 0) / bNegTotal : null;
  const after = daily.filter((d) => d.date >= start);
  const points = after.map((d, i) => ({
    day: i,
    date: d.date,
    volumeIndex: bVol ? (d.total / bVol) * 100 : null,
    negativeShare: d.total ? (d.negative / d.total) * 100 : null,
    baselineIndex: bVol ? 100 : null,
    baselineNegative: bNeg != null ? bNeg * 100 : null,
  }));
  const today = now.toISOString().slice(0, 10);
  const milestones = [30, 60, 90].map((m) => {
    const target = new Date(new Date(`${start}T00:00:00Z`).getTime() + m * 86400000).toISOString().slice(0, 10);
    if (target > today) return { day: m, date: target, reached: false, volumeIndex: null, negativeShare: null, recovered: null };
    const win = after.filter((d) => d.date <= target).slice(-7);
    const tot = win.reduce((a, d) => a + d.total, 0);
    const vol = win.length ? tot / win.length : null;
    const volumeIndex = vol != null && bVol ? (vol / bVol) * 100 : null;
    const negativeShare = tot ? (win.reduce((a, d) => a + d.negative, 0) / tot) * 100 : null;
    const recovered = volumeIndex == null || bNeg == null ? null : volumeIndex <= 125 && (negativeShare ?? 0) <= bNeg * 100 + 5;
    return { day: m, date: target, reached: true, volumeIndex, negativeShare, recovered };
  });
  return { baseline: { days: before.length, volume: bVol, negativeShare: bNeg != null ? bNeg * 100 : null }, points, milestones };
}

/** Daily totals between two dates (inclusive), zero-filled. */
export function dailyCounts(rows: { published_at: string | null; sentiment: string | null }[], from: string, to: string): DayCount[] {
  const out: DayCount[] = [];
  const idx = new Map<string, DayCount>();
  for (let t = new Date(`${from.slice(0, 10)}T00:00:00Z`).getTime(); t <= new Date(`${to.slice(0, 10)}T00:00:00Z`).getTime(); t += 86400000) {
    const d = { date: new Date(t).toISOString().slice(0, 10), total: 0, negative: 0 };
    out.push(d);
    idx.set(d.date, d);
  }
  for (const r of rows) {
    const d = r.published_at ? idx.get(new Date(r.published_at).toISOString().slice(0, 10)) : undefined;
    if (!d) continue;
    d.total++;
    if (r.sentiment === "negative") d.negative++;
  }
  return out;
}
