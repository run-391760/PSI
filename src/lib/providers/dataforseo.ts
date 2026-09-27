import { randomUUID } from "node:crypto";
import { query, transaction } from "@/lib/db";
import { AppError, database, locationCode } from "@/lib/domain";
import { liveEnabled } from "./source";

/**
 * DataForSEO v3 client with an atomic spend ledger (per user and deployment-wide, per month).
 * Every paid call reserves its worst-case cost first; a reservation is kept on ambiguous failures
 * because retrying a paid POST could charge twice.
 */
export type DfsTask<T = Record<string, any>> = {
  id: string;
  status_code: number;
  status_message: string;
  cost?: number;
  result?: T[] | null;
};

export async function reserve(owner: string, endpoint: string, micros: number) {
  const id = randomUUID();
  await transaction(async (q) => {
    const month = new Date().toISOString().slice(0, 7);
    await q("INSERT INTO account_usage(month) VALUES($1) ON CONFLICT DO NOTHING", [month]);
    const account = await q(
      "UPDATE account_usage SET reserved_micros=reserved_micros+$2 WHERE month=$1 AND reserved_micros+$2<=$3 RETURNING month",
      [month, micros, Number(process.env.GLOBAL_API_BUDGET_USD || 50) * 1e6],
    );
    if (!account.length) throw new AppError("The deployment-wide monthly API budget is used up.", 402);
    await q("INSERT INTO monthly_usage(owner_id,month) VALUES($1,$2) ON CONFLICT DO NOTHING", [owner, month]);
    const updated = await q(
      `UPDATE monthly_usage m SET reserved_micros=m.reserved_micros+$3 FROM users u
       WHERE m.owner_id=$1 AND m.month=$2 AND u.id=m.owner_id
       AND m.reserved_micros+$3 <= LEAST(u.monthly_budget_micros,$4) RETURNING m.owner_id`,
      [owner, month, micros, Number(process.env.MAX_MONTHLY_API_USD || 50) * 1e6],
    );
    if (!updated.length) throw new AppError("Your monthly API budget is used up. Raise it in Settings.", 402);
    await q("INSERT INTO usage_events(id,owner_id,endpoint,reserved_micros) VALUES($1,$2,$3,$4)", [id, owner, endpoint, micros]);
  });
  return id;
}

async function request<T>(endpoint: string, payload: unknown[] | undefined, reservation?: string): Promise<DfsTask<T>> {
  if (!liveEnabled()) throw new AppError("DataForSEO credentials are not configured.", 503);
  try {
    const response = await fetch(`https://api.dataforseo.com/v3/${endpoint}`, {
      method: payload ? "POST" : "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(60000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`DataForSEO HTTP ${response.status}`);
    const body = await response.json();
    const task = body.tasks?.[0] as DfsTask<T> | undefined;
    if (reservation)
      await query("UPDATE usage_events SET actual_micros=$2,status=$3 WHERE id=$1", [
        reservation,
        Math.round(Number(body.cost || 0) * 1e6),
        body.status_code === 20000 && task && task.status_code < 40000 ? "reported" : "provider_error",
      ]);
    if (body.status_code !== 20000 || !task || task.status_code >= 40000)
      throw new AppError(`DataForSEO: ${task?.status_message || body.status_message || "invalid response"}`, 502);
    return task;
  } catch (error) {
    if (reservation) await query("UPDATE usage_events SET status='check_provider' WHERE id=$1 AND status='reserved'", [reservation]);
    throw error;
  }
}

/**
 * Paid live call. `maxMicros` is the worst-case cost in millionths of a USD (e.g. 0.02 USD = 20000).
 * Returns task.result (an array; most "live" endpoints return one element with an `items` array).
 */
export async function dfs<T = Record<string, any>>(ownerId: string, endpoint: string, payload: Record<string, unknown>, maxMicros: number) {
  const reservation = await reserve(ownerId, endpoint, maxMicros);
  const task = await request<T>(endpoint, [payload], reservation);
  return task.result ?? [];
}
/** Free GET endpoints (task_get, locations...). */
export async function dfsGet<T = Record<string, any>>(endpoint: string) {
  return (await request<T>(endpoint, undefined)).result ?? [];
}

/** Standard location/language payload for a regional database code. */
export function market(db: string) {
  return { location_code: locationCode(db), language_code: database(db).language };
}

export async function monthlySpend(ownerId: string) {
  const month = new Date().toISOString().slice(0, 7);
  const [row] = await query<{ reserved_micros: string }>("SELECT reserved_micros FROM monthly_usage WHERE owner_id=$1 AND month=$2", [ownerId, month]);
  return Number(row?.reserved_micros || 0) / 1e6;
}

/** Paid call that also returns the task id (needed for task_post endpoints polled later via task_get). */
export async function dfsTask<T = Record<string, any>>(ownerId: string, endpoint: string, payload: Record<string, unknown>, maxMicros: number) {
  const reservation = await reserve(ownerId, endpoint, maxMicros);
  const task = await request<T>(endpoint, [payload], reservation);
  return { id: task.id, result: task.result ?? [] };
}
