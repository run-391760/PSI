/**
 * Chart parameters (dataviz method). Categorical slots are assigned in fixed order and follow the
 * entity, never its rank. Validated with the dataviz palette validator against #ffffff / #121620.
 */
export const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
] as const;
export const series = (i: number) => SERIES[i % SERIES.length];

/** Sequential single-hue ramp (magnitude), light -> dark. */
export const SEQ = ["var(--seq-100)", "var(--seq-200)", "var(--seq-300)", "var(--seq-400)", "var(--seq-500)", "var(--seq-600)", "var(--seq-700)"];

/** Status colors — only for meaning (good/warning/serious/critical), always with a label. */
export const STATUS = { good: "var(--good)", warning: "var(--warning)", serious: "var(--serious)", critical: "var(--critical)" } as const;

export const AXIS = {
  tick: { fill: "var(--chart-text)", fontSize: 11 },
  axisLine: { stroke: "var(--chart-axis)" },
  tickLine: false as const,
};
export const GRID = { stroke: "var(--chart-grid)", vertical: false };
