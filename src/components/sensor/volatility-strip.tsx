import { bandFor } from "@/lib/sensor/bands";

/** Tiny column strip of daily volatility scores colored by band (server-safe SVG). */
export function VolatilityStrip({ values, width = 120, height = 22, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  if (!values.length) return null;
  const bw = width / values.length;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={`Daily volatility: ${values.join(", ")}`}>
      {values.map((v, i) => {
        const h = Math.max(2, (Math.min(10, v) / 10) * height);
        return <rect key={i} x={i * bw + 0.4} y={height - h} width={Math.max(1, bw - 1.2)} height={h} rx={1} fill={bandFor(v).color} opacity={i === values.length - 1 ? 1 : 0.7} />;
      })}
    </svg>
  );
}
