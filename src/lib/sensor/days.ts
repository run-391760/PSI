/** Pure UTC day helpers shared by the SERP Sensor (no engine or database imports). */
const DAY = 86400000;
export const dayNum = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
export const isoDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** `count` ISO dates ending on `end` (UTC, default today), oldest first. */
export function lastDays(count: number, end = todayIso()) {
  const e = dayNum(end);
  return Array.from({ length: count }, (_, i) => isoDay(e - count + 1 + i));
}
