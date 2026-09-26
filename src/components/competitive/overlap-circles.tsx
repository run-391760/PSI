import { compact } from "@/lib/format";

/**
 * Venn-like overlap diagram: one circle per domain, area ∝ its count, centers pulled together by
 * pairwise overlap. Approximate by design (exact Venn areas are impossible beyond 3 sets); the exact
 * numbers are in the legend next to it. Server-safe SVG.
 */
export function OverlapCircles({ items, overlap, sharedByAll, height = 240, sharedLabel = "shared" }: { items: { label: string; count: number; color: string }[]; overlap: number[][]; sharedByAll: number; height?: number; sharedLabel?: string }) {
  const W = 420;
  const H = height;
  const n = items.length;
  if (!n) return null;
  const maxCount = Math.max(...items.map((i) => i.count), 1);
  const maxR = n <= 2 ? H * 0.38 : n === 3 ? H * 0.32 : H * 0.28;
  let radii = items.map((i) => Math.max(18, maxR * Math.sqrt(i.count / maxCount)));
  const frac = (i: number, j: number) => overlap[i]?.[j] / Math.max(1, Math.min(items[i].count, items[j].count)) || 0;
  let centers: { x: number; y: number }[];
  if (n === 1) centers = [{ x: W / 2, y: H / 2 }];
  else if (n === 2) {
    const d = Math.max(Math.abs(radii[0] - radii[1]) + 6, (radii[0] + radii[1]) * (1 - 0.7 * frac(0, 1)));
    const left = -radii[0];
    const right = d + radii[1];
    const shift = W / 2 - (left + right) / 2;
    centers = [
      { x: shift, y: H / 2 },
      { x: shift + d, y: H / 2 },
    ];
  } else {
    let sum = 0,
      pairs = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) (sum += frac(i, j)), pairs++;
    const avgR = radii.reduce((a, r) => a + r, 0) / n;
    const rho = avgR * (1.3 - 0.65 * (sum / Math.max(1, pairs)));
    centers = items.map((_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return { x: W / 2 + rho * Math.cos(a), y: H / 2 + rho * Math.sin(a) };
    });
    // Fit into the canvas.
    const extentX = Math.max(...centers.map((c, i) => Math.abs(c.x - W / 2) + radii[i]));
    const extentY = Math.max(...centers.map((c, i) => Math.abs(c.y - H / 2) + radii[i]));
    const s = Math.min(1, (W / 2 - 4) / extentX, (H / 2 - 4) / extentY);
    centers = centers.map((c) => ({ x: W / 2 + (c.x - W / 2) * s, y: H / 2 + (c.y - H / 2) * s }));
    radii = radii.map((r) => r * s);
  }
  const mid = n === 2 ? { x: (centers[0].x + centers[1].x) / 2, y: H / 2 } : { x: W / 2, y: H / 2 };
  const text = { paintOrder: "stroke" as const, stroke: "var(--surface)", strokeWidth: 3, strokeLinejoin: "round" as const };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" style={{ maxHeight: H }} role="img" aria-label={items.map((i) => `${i.label}: ${i.count}`).join(", ")}>
      {items.map((it, i) => (
        <circle key={it.label} cx={centers[i].x} cy={centers[i].y} r={radii[i]} fill={it.color} fillOpacity={0.2} stroke={it.color} strokeWidth={1.75} />
      ))}
      {n > 1 &&
        items.map((it, i) => {
          const dx = centers[i].x - mid.x;
          const dy = centers[i].y - mid.y;
          const len = Math.hypot(dx, dy) || 1;
          const x = centers[i].x + (dx / len) * radii[i] * 0.45;
          const y = centers[i].y + (dy / len) * radii[i] * 0.45;
          return (
            <text key={it.label} x={x} y={y + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--text)" style={text}>
              {compact(it.count)}
            </text>
          );
        })}
      {n === 1 && (
        <text x={W / 2} y={H / 2 + 4} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--text)" style={text}>
          {compact(items[0].count)}
        </text>
      )}
      {n > 1 && (
        <g>
          <text x={mid.x} y={mid.y + 1} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--text)" style={text}>
            {compact(sharedByAll)}
          </text>
          <text x={mid.x} y={mid.y + 15} textAnchor="middle" fontSize={10.5} fill="var(--text-2)" style={text}>
            {sharedLabel}
          </text>
        </g>
      )}
    </svg>
  );
}
