import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { schema } from "./schema";

export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
type Database = {
  query: Query;
  exec: (sql: string) => Promise<void>;
  transaction: <T>(fn: (q: Query) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};
const state = globalThis as unknown as { synapseDb?: Promise<Database>; synapseSchemas?: Set<string> };

async function connect(): Promise<Database> {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    const setup = await pool.connect();
    try {
      await setup.query("BEGIN");
      await setup.query("SELECT pg_advisory_xact_lock(32003200)");
      await setup.query(schema);
      await setup.query("COMMIT");
    } catch (error) {
      await setup.query("ROLLBACK");
      throw error;
    } finally {
      setup.release();
    }
    return {
      close: () => pool.end(),
      exec: async (sql) => void (await pool.query(sql)),
      query: async <T>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[],
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(async <T>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[]);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_PATH || path.join(process.cwd(), ".data", "postgres");
  if (dir !== "memory://") {
    await mkdir(path.dirname(dir), { recursive: true });
    acquireLock(dir);
  }
  const pg = new PGlite(dir);
  await pg.exec(schema);
  closeOnShutdown(() => pg.close());
  return {
    close: () => pg.close(),
    exec: async (sql) => void (await pg.exec(sql)),
    query: async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows,
    transaction: (fn) =>
      pg.transaction((tx) => fn(async <T>(sql: string, params: unknown[] = []) => (await tx.query<T>(sql, params)).rows)),
  };
}

/**
 * PGlite is an embedded, single-process PostgreSQL: two processes writing the same data directory
 * corrupt its write-ahead log. A pid lock file refuses a second opener with a clear error.
 */
function acquireLock(dir: string) {
  const lock = `${dir}.lock`;
  let holder = 0;
  try {
    holder = Number(readFileSync(lock, "utf8").trim());
  } catch {
    /* no lock file */
  }
  if (holder && holder !== process.pid) {
    let alive = true;
    try {
      process.kill(holder, 0);
    } catch (error) {
      alive = (error as NodeJS.ErrnoException).code === "EPERM";
    }
    if (alive)
      throw new Error(
        `The embedded database at ${dir} is already open in process ${holder}. PGlite supports one process only: stop the other server/script, or set DATABASE_URL to use PostgreSQL.`,
      );
  }
  writeFileSync(lock, String(process.pid));
  process.once("exit", () => {
    try {
      if (readFileSync(lock, "utf8").trim() === String(process.pid)) unlinkSync(lock);
    } catch {
      /* already gone */
    }
  });
}

/** Flush and close the embedded database when the server is stopped (Ctrl+C / SIGTERM). */
function closeOnShutdown(close: () => Promise<void>) {
  const g = globalThis as unknown as { synapseDbShutdown?: boolean };
  if (g.synapseDbShutdown) return;
  g.synapseDbShutdown = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      const timer = setTimeout(() => process.exit(0), 3000);
      close()
        .catch(() => {})
        .finally(() => {
          clearTimeout(timer);
          process.exit(0);
        });
    });
}

/**
 * Shared connection. PGlite is single-process: only the Next.js server may open .data/postgres.
 * The schema is idempotent SQL; when a module adds tables during development the new schema text is
 * applied once to the live connection (no restart needed).
 */
export function database() {
  state.synapseSchemas ??= new Set();
  if (!state.synapseDb) {
    state.synapseSchemas.add(schema);
    state.synapseDb = connect();
  } else if (!state.synapseSchemas.has(schema)) {
    state.synapseSchemas.add(schema);
    const sql = schema;
    state.synapseDb = state.synapseDb.then(async (db) => {
      try {
        await db.exec(sql);
      } catch (error) {
        console.error("[db] schema update failed:", error instanceof Error ? error.message : error);
      }
      return db;
    });
  }
  return state.synapseDb;
}
export const query: Query = async (sql, params = []) => (await database()).query(sql, params);
export async function transaction<T>(fn: (q: Query) => Promise<T>) {
  return (await database()).transaction(fn);
}
export async function closeDatabase() {
  if (state.synapseDb) {
    await (await state.synapseDb).close();
    delete state.synapseDb;
  }
}
