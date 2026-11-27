import assert from "node:assert/strict";
import { test } from "node:test";
import { rankLeaders, type LeaderTicket } from "../src/lib/cx/insights/leaderboard";

const now = new Date("2026-11-27T12:00:00Z");
const at = (h: number) => new Date(now.getTime() - h * 3600000).toISOString();
const t = (assignee: string, o: Partial<LeaderTicket> = {}): LeaderTicket => ({ assignee_id: assignee, csat: null, created_at: at(10), first_response_at: null, resolved_at: null, priority: "normal", ...o });
const members = ["asha", "ravi", "neha", "dev"].map((id) => ({ id, name: id, email: `${id}@x.in`, role: "agent" }));

test("rankLeaders: solved, then replies, then faster first response; idle users listed without a rank", () => {
  const tickets = [
    t("asha", { resolved_at: at(1), first_response_at: at(9), csat: 5 }), t("asha", { resolved_at: at(2), first_response_at: at(8), csat: 3 }),
    t("ravi", { resolved_at: at(1), first_response_at: at(9.5) }), t("ravi"),
    t("neha", { resolved_at: at(1), first_response_at: at(5) }),
  ];
  const rows = rankLeaders(members, tickets, new Map([["ravi", 12], ["neha", 12], ["asha", 2]]), new Map([["asha", 88.4]]), now);
  assert.deepEqual(rows.map((r) => [r.id, r.rank]), [["asha", 1], ["ravi", 2], ["neha", 3], ["dev", 0]]);
  const asha = rows[0];
  assert.equal(asha.assigned, 2);
  assert.equal(asha.solved, 2);
  assert.equal(asha.frt, 1.5 * 3600); // (1h + 2h) / 2
  assert.equal(asha.csat, 50); // one of two ratings is 4–5
  assert.equal(asha.qa, 88.4);
  const dev = rows[3];
  assert.deepEqual([dev.replies, dev.assigned, dev.solved, dev.frt, dev.sla, dev.csat, dev.qa], [0, 0, 0, null, null, null, null], "missing is n/a, not 0");
});

test("rankLeaders: identical work shares a rank", () => {
  const rows = rankLeaders(members.slice(0, 2), [], new Map([["asha", 3], ["ravi", 3]]), new Map(), now);
  assert.deepEqual(rows.map((r) => r.rank), [1, 1]);
});
