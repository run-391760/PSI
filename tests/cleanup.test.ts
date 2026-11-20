import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { AppError } from "../src/lib/domain";
import { jobHandlers } from "../src/lib/jobs/http";
import type { JobRow } from "../src/lib/jobs/types";
import { buildXlsx, zip } from "../src/lib/cx/inbox/xlsx";
import { writeXlsx, unzip } from "../src/lib/cx/publishing/xlsx";
import { crc32, zipStore } from "../src/lib/exports/zip";

const job: JobRow = {
  id: "job", owner_id: "owner", project_id: "project", kind: "local.scan", status: "running",
  payload: { secret: true }, result: { count: 2 }, progress: 1, total: 2, message: "Scanning",
  error: null, attempts: 1, created_at: "2026-11-18", started_at: null, finished_at: null,
};
const ctx = () => ({ params: Promise.resolve({ id: job.id }) });
const req = new Request("http://localhost/api/local/jobs/job");

function setup(options: Parameters<typeof jobHandlers>[1] = {}, overrides: Partial<Parameters<typeof jobHandlers>[2]> = {}) {
  const calls: string[][] = [];
  const handlers = jobHandlers("local.", options, {
    requireUser: async () => ({ id: "owner" }),
    getJob: async (owner, id) => { calls.push(["get", owner, id]); return job; },
    cancelJob: async (owner, id) => { calls.push(["cancel", owner, id]); },
    ...overrides,
  });
  return { ...handlers, calls };
}

test("job polling keeps its public fields, cache policy and optional result", async () => {
  for (const includeResult of [false, true]) {
    const h = setup({ includeResult });
    const res = await h.GET(req, ctx());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await res.json(), {
      id: job.id, kind: job.kind, status: job.status, progress: job.progress,
      total: job.total, message: job.message, error: job.error,
      ...(includeResult ? { result: job.result } : {}),
    });
    assert.deepEqual(h.calls, [["get", "owner", "job"]]);
  }
});

test("job cancellation checks the owner and module before writing", async () => {
  const h = setup();
  assert.deepEqual(await (await h.DELETE(req, ctx())).json(), { ok: true });
  assert.deepEqual(h.calls, [["get", "owner", "job"], ["cancel", "owner", "job"]]);
  for (const method of ["GET", "DELETE"] as const) {
    const wrongModule = setup({}, { getJob: async () => ({ ...job, kind: "content.scan" }) });
    const res = await wrongModule[method](req, ctx());
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "Job not found." });
    assert.deepEqual(wrongModule.calls, []);
  }
});

test("job routes preserve authentication, missing-job and unexpected-error responses", async () => {
  for (const method of ["GET", "DELETE"] as const) {
    for (const [error, status, message] of [
      [new AppError("Sign in.", 401), 401, "Sign in."],
      [new AppError("Job not found.", 404), 404, "Job not found."],
      [new Error("Network failed."), 500, "Network failed."],
      [null, 500, "Request failed."],
    ] as const) {
      const h = setup({ errorMessage: "Request failed." }, { requireUser: async () => { throw error; } });
      const res = await h[method](req, ctx());
      assert.equal(res.status, status);
      assert.deepEqual(await res.json(), { error: message });
      assert.deepEqual(h.calls, []);
    }
    const missing = setup({}, { getJob: async () => { throw new AppError("Job not found.", 404); } });
    assert.equal((await missing[method](req, ctx())).status, 404);
    assert.deepEqual(missing.calls, []);
  }
});

test("spreadsheet exports remain byte-for-byte compatible with existing downloads", () => {
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  const inbox = buildXlsx([
    { name: "Report & 日本語", rows: [["Label", "Value"], ['comma,quote"\n', 42], ["é", null], ["control\u0001", -1.5]] },
    { name: "Empty", rows: [] },
  ]);
  const publishing = writeXlsx([
    { name: "Bulk", rows: [["Text", "Date"], ["é & <tag>", "2026-11-18"], ["line\nbreak", ""]], widths: [30, 20] },
  ]);
  assert.equal(sha(inbox), "d96d802f0d93deff4a854152fe35220f70c5a986a0852ea891521d677371b77f");
  assert.equal(sha(publishing), "7035ea971297fcf99958e11dc6609835461b387e71ca676965d14794bc599f82");
});

test("shared ZIP storage preserves Unicode names, empty entries and binary data", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const files = [{ name: "日本語.bin", data: Uint8Array.of(0, 255, 128, 10) }, { name: "empty", data: new Uint8Array() }];
  const bytes = zipStore(files);
  const entries = unzip(bytes, () => { throw new Error("Stored entries must not need inflation."); });
  for (const f of files) assert.deepEqual(entries.get(f.name), f.data);
  assert.deepEqual(zip(files), Buffer.from(bytes));
  assert.equal(unzip(zipStore([]), (b) => b).size, 0);
});
