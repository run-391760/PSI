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

export const AXIS = {
  tick: { fill: "var(--chart-text)", fontSize: 11 },
  axisLine: { stroke: "var(--chart-axis)" },
  tickLine: false as const,
};
export const GRID = { stroke: "var(--chart-grid)", vertical: false };
