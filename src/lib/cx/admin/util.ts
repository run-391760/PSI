/** Small shared helpers of the admin package (server-safe, no imports). */
export const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
export const clampInt = (v: unknown, min: number, max: number, fallback: number | null = null) => {
  const n = Math.round(Number(v));
  return v === "" || v == null || Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n));
};
export const trimTo = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
