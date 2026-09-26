import { series } from "@/components/charts/theme";

export type MindLeaf = { label: string; sub?: string; href?: string };
export type MindBranch = { label: string; sub?: string; href?: string; children: MindLeaf[] };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Horizontal tree (root → branches → leaves) drawn as server-safe SVG. Branch identity uses the
 * categorical series slots (dot + link), text stays in ink tokens. Scrolls horizontally on narrow screens.
 */
export function MindMap({ root, rootSub, branches, maxLeaves = 6, ariaLabel }: { root: string; rootSub?: string; branches: MindBranch[]; maxLeaves?: number; ariaLabel?: string }) {
  const ROW = 24;
  const GAP = 14;
  const X0 = 16,
    X1 = 250,
    X2 = 560,
    W = 900;
  let y = 20;
  const placed = branches.map((b) => {
    const leaves = b.children.slice(0, maxLeaves);
    const more = b.children.length - leaves.length;
    const slots = Math.max(1, leaves.length + (more > 0 ? 1 : 0));
    const top = y;
    const leafYs = leaves.map((_, i) => top + i * ROW + ROW / 2);
    y += slots * ROW + GAP;
    return { b, leaves, more, leafYs, moreY: top + leaves.length * ROW + ROW / 2, cy: top + (slots * ROW) / 2 };
  });
  const H = Math.max(y + 6, 120);
  const rootY = H / 2;
  const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
  return (
    <div className="scroll-thin overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 760 }} role="img" aria-label={ariaLabel ?? `Mind map of ${root}`} className="text-[12px]">
        {placed.map(({ b, leaves, leafYs, more, moreY, cy }, i) => (
          <g key={`l${i}`} fill="none" stroke={series(i)} strokeOpacity={0.45} strokeWidth={1.5}>
            <path d={curve(X0 + 190, rootY, X1 - 8, cy)} />
            {leaves.map((_, j) => (
              <path key={j} d={curve(X1 + 238, cy, X2 - 6, leafYs[j])} strokeOpacity={0.3} strokeWidth={1.2} />
            ))}
            {more > 0 && <path d={curve(X1 + 238, cy, X2 - 6, moreY)} strokeOpacity={0.2} strokeWidth={1.2} strokeDasharray="3 3" />}
          </g>
        ))}
        <g>
          <rect x={X0} y={rootY - 24} width={190} height={48} rx={10} fill="var(--brand-soft)" stroke="var(--brand)" strokeOpacity={0.4} />
          <text x={X0 + 12} y={rootY - (rootSub ? 3 : -5)} fill="var(--text)" fontSize={14} fontWeight={600}>
            {clip(root, 22)}
          </text>
          {rootSub && (
            <text x={X0 + 12} y={rootY + 14} fill="var(--text-3)" fontSize={11}>
              {rootSub}
            </text>
          )}
        </g>
        {placed.map(({ b, leaves, leafYs, more, moreY, cy }, i) => {
          const branch = (
            <g>
              <rect x={X1 - 8} y={cy - 17} width={246} height={34} rx={8} fill="var(--surface)" stroke="var(--border-strong)" />
              <circle cx={X1 + 6} cy={cy} r={4.5} fill={series(i)} />
              <text x={X1 + 17} y={cy + (b.sub ? -2 : 4)} fill="var(--text)" fontSize={12.5} fontWeight={600}>
                {clip(b.label, 30)}
              </text>
              {b.sub && (
                <text x={X1 + 17} y={cy + 11} fill="var(--text-3)" fontSize={10.5}>
                  {b.sub}
                </text>
              )}
            </g>
          );
          return (
            <g key={`b${i}`}>
              {b.href ? <a href={b.href}>{branch}</a> : branch}
              {leaves.map((l, j) => {
                const leaf = (
                  <g>
                    <circle cx={X2} cy={leafYs[j]} r={3} fill={series(i)} fillOpacity={0.7} />
                    <text x={X2 + 9} y={leafYs[j] + 4} fill="var(--text-2)" fontSize={12}>
                      {clip(l.label, 44)}
                      {l.sub && (
                        <tspan fill="var(--text-3)" fontSize={11}>
                          {"  "}
                          {l.sub}
                        </tspan>
                      )}
                    </text>
                  </g>
                );
                return <g key={j}>{l.href ? <a href={l.href}>{leaf}</a> : leaf}</g>;
              })}
              {more > 0 && (
                <text x={X2 + 9} y={moreY + 4} fill="var(--text-3)" fontSize={11.5}>
                  +{more} more
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
