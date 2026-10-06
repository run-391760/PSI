/**
 * Declutter preferences: pure, client-safe logic (no DB, no React). Used by the shell (focus mode,
 * density, menu customisation), <Hideable> panels and the server loader/actions.
 */

export type Density = "comfortable" | "compact";
export type PanelState = "open" | "collapsed" | "hidden";
export type PanelPref = { state: PanelState; label: string };

export type NavPrefs = {
  /** Items pinned to the top "Pinned" group, in pin order. */
  pinned: string[];
  /** Items the user hid from the sidebar. */
  hidden: string[];
  /** Items hidden by default (`defaultHidden`) that the user chose to show. */
  shown: string[];
  /** Custom item order per group id (hrefs). Unknown/new items keep their default position at the end. */
  order: Record<string, string[]>;
};

export type UiPrefs = {
  focus: boolean;
  density: Density;
  /** Sidebar collapsed to an icon rail (desktop). */
  collapsed: boolean;
  nav: NavPrefs;
  /** Panel id ("<scope>.<name>") → state + label (label kept so "Show hidden" can list it server-side). */
  panels: Record<string, PanelPref>;
};

export const DEFAULT_NAV: NavPrefs = { pinned: [], hidden: [], shown: [], order: {} };
export const DEFAULT_PREFS: UiPrefs = { focus: false, density: "comfortable", collapsed: false, nav: DEFAULT_NAV, panels: {} };

const MAX_LIST = 200;
const MAX_KEY = 160;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strList = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= MAX_KEY))].slice(0, MAX_LIST) : [];

export function normalizeNav(raw: unknown): NavPrefs {
  if (!isObj(raw)) return { ...DEFAULT_NAV, order: {} };
  const order: Record<string, string[]> = {};
  if (isObj(raw.order))
    for (const [k, v] of Object.entries(raw.order).slice(0, 50)) if (k.length <= MAX_KEY) {
      const list = strList(v);
      if (list.length) order[k] = list;
    }
  return { pinned: strList(raw.pinned), hidden: strList(raw.hidden), shown: strList(raw.shown), order };
}

export function normalizePanels(raw: unknown): Record<string, PanelPref> {
  const out: Record<string, PanelPref> = {};
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw).slice(0, MAX_LIST)) {
    if (id.length > MAX_KEY || !isObj(v)) continue;
    const state = v.state;
    if (state !== "open" && state !== "collapsed" && state !== "hidden") continue;
    out[id] = { state, label: typeof v.label === "string" ? v.label.slice(0, 120) : id };
  }
  return out;
}

/** Coerce anything (stored jsonb, client payload) into valid preferences. */
export function normalizePrefs(raw: unknown): UiPrefs {
  const r = isObj(raw) ? raw : {};
  return {
    focus: r.focus === true,
    density: r.density === "compact" ? "compact" : "comfortable",
    collapsed: r.collapsed === true,
    nav: normalizeNav(r.nav),
    panels: normalizePanels(r.panels),
  };
}

/** Validate a partial update: only known top-level keys, each normalised. */
export function normalizePatch(raw: unknown): Partial<UiPrefs> {
  if (!isObj(raw)) return {};
  const full = normalizePrefs(raw);
  const out: Partial<UiPrefs> = {};
  if ("focus" in raw) out.focus = full.focus;
  if ("density" in raw) out.density = full.density;
  if ("collapsed" in raw) out.collapsed = full.collapsed;
  if ("nav" in raw) out.nav = full.nav;
  if ("panels" in raw) out.panels = full.panels;
  return out;
}

// ------------------------------------------------------------------ menu customisation

type Item = { href: string; defaultHidden?: boolean };
type Group<I extends Item> = { id: string; label: string; items: I[] };

export function isNavItemHidden(item: Item, nav: NavPrefs) {
  if (nav.pinned.includes(item.href)) return false;
  if (nav.hidden.includes(item.href)) return true;
  return !!item.defaultHidden && !nav.shown.includes(item.href);
}

/** Items of a group in the user's order (unknown items keep their default order, appended). */
export function orderedItems<I extends Item>(group: Group<I>, nav: NavPrefs): I[] {
  const order = nav.order[group.id];
  if (!order?.length) return group.items;
  const pos = new Map(order.map((h, i) => [h, i]));
  return group.items
    .map((it, i) => ({ it, key: pos.has(it.href) ? pos.get(it.href)! : order.length + i }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.it);
}

export const PINNED_GROUP_ID = "pinned";

/**
 * The sidebar as the user customised it: a "Pinned" group first (pin order), then each group in the
 * user's order without hidden or pinned items. Empty groups are dropped.
 */
export function applyNavPrefs<I extends Item>(groups: Group<I>[], nav: NavPrefs): Group<I>[] {
  const all = new Map(groups.flatMap((g) => g.items.map((i) => [i.href, i] as const)));
  const pinned = nav.pinned.map((h) => all.get(h)).filter((i): i is I => !!i);
  const out: Group<I>[] = [];
  if (pinned.length) out.push({ id: PINNED_GROUP_ID, label: "Pinned", items: pinned });
  for (const g of groups) {
    const items = orderedItems(g, nav).filter((i) => !nav.pinned.includes(i.href) && !isNavItemHidden(i, nav));
    if (items.length) out.push({ ...g, items });
  }
  return out;
}

/** Items that are not in the sidebar (hidden by the user or by default) — listed on the Settings hub. */
export function hiddenNavItems<I extends Item>(groups: Group<I>[], nav: NavPrefs): I[] {
  return groups.flatMap((g) => g.items).filter((i) => isNavItemHidden(i, nav));
}

const without = (list: string[], v: string) => list.filter((x) => x !== v);

export function togglePin(nav: NavPrefs, href: string): NavPrefs {
  if (nav.pinned.includes(href)) return { ...nav, pinned: without(nav.pinned, href) };
  return { ...nav, pinned: [...nav.pinned, href], hidden: without(nav.hidden, href) };
}

/** Show/hide an item. Hiding also unpins; showing a default-hidden item records it in `shown`. */
export function setItemHidden(nav: NavPrefs, item: Item, hidden: boolean): NavPrefs {
  const h = item.href;
  if (hidden)
    return { ...nav, pinned: without(nav.pinned, h), shown: without(nav.shown, h), hidden: item.defaultHidden ? without(nav.hidden, h) : [...without(nav.hidden, h), h] };
  return { ...nav, hidden: without(nav.hidden, h), shown: item.defaultHidden ? [...without(nav.shown, h), h] : without(nav.shown, h) };
}

/** Move an item up (-1) or down (+1) within its group; stores the full group order. */
export function moveItem<I extends Item>(nav: NavPrefs, group: Group<I>, href: string, dir: -1 | 1): NavPrefs {
  const list = orderedItems(group, nav).map((i) => i.href);
  const i = list.indexOf(href);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return nav;
  [list[i], list[j]] = [list[j], list[i]];
  return { ...nav, order: { ...nav.order, [group.id]: list } };
}

/**
 * Move a pinned item within the pinned list. `within` limits the move to the items it accepts (one
 * workspace's pins: the list is shared by SEO and CX), skipping over the others.
 */
export function movePinned(nav: NavPrefs, href: string, dir: -1 | 1, within?: (href: string) => boolean): NavPrefs {
  const list = [...nav.pinned];
  const i = list.indexOf(href);
  let j = i + dir;
  if (within) while (j >= 0 && j < list.length && !within(list[j])) j += dir;
  if (i < 0 || j < 0 || j >= list.length) return nav;
  [list[i], list[j]] = [list[j], list[i]];
  return { ...nav, pinned: list };
}

export const navIsDefault = (nav: NavPrefs) => !nav.pinned.length && !nav.hidden.length && !nav.shown.length && !Object.keys(nav.order).length;

/**
 * The part of the nav prefs that belongs to one menu (prefs.nav is shared by the SEO and CX
 * workspaces): `scoped` = whether it has any customisation, `reset()` = prefs without it.
 */
export function scopeNav<I extends Item>(nav: NavPrefs, groups: Group<I>[]) {
  const hrefs = new Set(groups.flatMap((g) => g.items.map((i) => i.href)));
  const ids = new Set(groups.map((g) => g.id));
  const own = (h: string) => hrefs.has(h);
  const scoped = nav.pinned.some(own) || nav.hidden.some(own) || nav.shown.some(own) || Object.keys(nav.order).some((k) => ids.has(k));
  const reset = (): NavPrefs => ({
    pinned: nav.pinned.filter((h) => !own(h)),
    hidden: nav.hidden.filter((h) => !own(h)),
    shown: nav.shown.filter((h) => !own(h)),
    order: Object.fromEntries(Object.entries(nav.order).filter(([k]) => !ids.has(k))),
  });
  return { own, scoped, pinned: nav.pinned.filter(own), reset };
}

/** Longest matching href wins, so a parent (/cx/listening) isn't highlighted on its sub-pages. */
export function activeHref(pathname: string, hrefs: string[]) {
  return hrefs.filter((h) => pathname === h || pathname.startsWith(`${h}/`)).sort((a, b) => b.length - a.length)[0];
}

// ------------------------------------------------------------------ hideable panels

export function panelState(panels: Record<string, PanelPref>, id: string, fallback: PanelState = "open"): PanelState {
  return panels[id]?.state ?? fallback;
}

/** Set a panel's state; returning to the default state drops the entry so storage stays small. */
export function setPanel(panels: Record<string, PanelPref>, id: string, state: PanelState, label: string, fallback: PanelState = "open") {
  const next = { ...panels };
  if (state === fallback) delete next[id];
  else next[id] = { state, label };
  return next;
}

/** Hidden panels of a page scope ("cx-overview" matches "cx-overview.trends"). */
export function hiddenPanels(panels: Record<string, PanelPref>, scope: string) {
  return Object.entries(panels)
    .filter(([id, p]) => p.state === "hidden" && (id === scope || id.startsWith(`${scope}.`)))
    .map(([id, p]) => ({ id, label: p.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Restore hidden panels (all, or those of a scope). */
export function restorePanels(panels: Record<string, PanelPref>, scope?: string) {
  const next: Record<string, PanelPref> = {};
  for (const [id, p] of Object.entries(panels)) {
    const inScope = !scope || id === scope || id.startsWith(`${scope}.`);
    if (p.state === "hidden" && inScope) continue;
    next[id] = p;
  }
  return next;
}

// ------------------------------------------------------------------ keyboard

/** Focus mode shortcut: ⌘\ / Ctrl+\ (ignored while typing in a field). */
export function isFocusShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey?: boolean }) {
  return (e.metaKey || e.ctrlKey) && !e.altKey && e.key === "\\";
}
