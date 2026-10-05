/**
 * Classifications report (WP-K4): pure, client-safe aggregation over the ticket classification tree.
 * Fixture-tested in tests/cx-k4-listening.test.ts.
 *
 * A ticket stores its classification as the full path (root → leaf ids, see normalizeSelection in
 * @/lib/cx/admin/pure/fields), so "a ticket counts under a node when its path contains the node id" includes
 * tickets classified under any sub-classification — exactly what the drill-down (`classification: <id>`) matches.
 */
import type { ClassificationNode } from "@/lib/cx/admin/fields";
import { sentimentCounts, type RRow } from "./model";

export type CNode = Pick<ClassificationNode, "id" | "parentId" | "label" | "hidden">;
/** A ticket row with its stored classification path. */
export type CRow = Pick<RRow, "sentiment" | "at"> & { classes: string[] };

/** Direct children of a node (null = top level), in tree order. */
export const childrenOf = <T extends CNode>(nodes: T[], parentId: string | null) => nodes.filter((n) => (n.parentId ?? null) === parentId);

/** Root → node chain (for the breadcrumb); empty when the id is unknown. Guards against cycles. */
export function pathTo<T extends CNode>(nodes: T[], id: string | null | undefined): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: T[] = [];
  for (let n = id ? byId.get(id) : undefined, g = 0; n && g < 20; n = n.parentId ? byId.get(n.parentId) : undefined, g++) out.unshift(n);
  return out;
}

/** The ?node= value if it names a node with children, else null (top level). */
export function pickNode(nodes: CNode[], id: string | null | undefined) {
  if (!id || !nodes.some((n) => n.id === id)) return null;
  return childrenOf(nodes, id).length ? id : null;
}

/** All descendant ids of a node. */
export function descendants(nodes: CNode[], id: string) {
  const out: string[] = [];
  const walk = (p: string, g: number) => {
    if (g > 20) return;
    for (const c of childrenOf(nodes, p)) {
      out.push(c.id);
      walk(c.id, g + 1);
    }
  };
  walk(id, 0);
  return out;
}

/**
 * Breakdown of one level of the tree: every child of `parentId` (null = top level) with its ticket counts by
 * sentiment and share of the level's tickets. The level's tickets are all tickets (top level) or the parent's
 * tickets. `rest` = level tickets with no classification at this level ("Unclassified" at the top,
 * "No sub-classification" below). Hidden nodes without tickets are left out.
 */
export function levelBreakdown(rows: CRow[], nodes: CNode[], parentId: string | null) {
  const level = parentId ? rows.filter((r) => r.classes.includes(parentId)) : rows;
  const kids = childrenOf(nodes, parentId);
  const kidIds = new Set(kids.map((k) => k.id));
  const items = kids
    .map((k) => {
      const of = level.filter((r) => r.classes.includes(k.id));
      return { id: k.id, label: k.label, hidden: k.hidden, hasChildren: childrenOf(nodes, k.id).length > 0, ...sentimentCounts(of), share: level.length ? (of.length / level.length) * 100 : 0 };
    })
    .filter((k) => !(k.hidden && k.total === 0));
  const rest = level.filter((r) => !r.classes.some((c) => kidIds.has(c)));
  return { base: level.length, items, rest: { ...sentimentCounts(rest), share: level.length ? (rest.length / level.length) * 100 : 0 } };
}

/** Tickets with any classification vs none. */
export function classifiedCounts(rows: Pick<CRow, "classes">[]) {
  const classified = rows.filter((r) => r.classes.length > 0).length;
  return { total: rows.length, classified, unclassified: rows.length - classified, rate: rows.length ? (classified / rows.length) * 100 : null };
}

/** Clean a stored classification_ids value (jsonb array, possibly null or malformed) into a string list. */
export const asIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : []);
