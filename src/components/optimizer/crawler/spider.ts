import type { Block, Touch } from "@/lib/optimizer/crawl/types";

/**
 * The crawler spider (client, framework-free). A stick-figure spider with 8 long two-segment legs
 * walks down the page snapshot: for every "touch" event it moves its body within reach, extends
 * the nearest free leg to the element's box (two-bone inverse kinematics with a knee), and marks
 * the element with the measured result. Idle legs re-plant in an alternating gait as the body
 * moves. Everything runs on one requestAnimationFrame loop that writes SVG attributes and data
 * attributes directly — React only renders the snapshot. Layout is read once per page (and on
 * resize), never inside the frame loop.
 */

export type Vec = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

const len = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Two-bone IK: the knee of a leg from `hip` to `foot` with segment lengths l1/l2, bending away from
 * `away` (the body). A foot out of reach is pulled in along the hip→foot line.
 */
export function solveLeg(hip: Vec, foot: Vec, l1: number, l2: number, away: Vec): { knee: Vec; foot: Vec } {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  const raw = Math.hypot(dx, dy) || 0.0001;
  const d = clamp(raw, Math.abs(l1 - l2) + 0.5, l1 + l2 - 0.5);
  const ux = dx / raw;
  const uy = dy / raw;
  const f = { x: hip.x + ux * d, y: hip.y + uy * d };
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const px = hip.x + ux * a;
  const py = hip.y + uy * a;
  const k1 = { x: px - uy * h, y: py + ux * h };
  const k2 = { x: px + uy * h, y: py - ux * h };
  return { knee: len(k1, away) >= len(k2, away) ? k1 : k2, foot: f };
}

/** Nearest point of a rectangle to p (on its edge when p is inside). */
export function nearestOnRect(p: Vec, r: Rect): Vec {
  const x = clamp(p.x, r.x, r.x + r.w);
  const y = clamp(p.y, r.y, r.y + r.h);
  if (x !== p.x || y !== p.y) return { x, y };
  const d = [p.x - r.x, r.x + r.w - p.x, p.y - r.y, r.y + r.h - p.y];
  const m = Math.min(...d);
  return m === d[0] ? { x: r.x, y: p.y } : m === d[1] ? { x: r.x + r.w, y: p.y } : m === d[2] ? { x: p.x, y: r.y } : { x: p.x, y: r.y + r.h };
}

// Legs 0–3 on the left (front to back), 4–7 on the right. Angles: 0 = up, clockwise.
const HIPS: Vec[] = [
  { x: -3, y: -7 },
  { x: -4.5, y: -4 },
  { x: -4.5, y: -1 },
  { x: -3.5, y: 2 },
  { x: 3, y: -7 },
  { x: 4.5, y: -4 },
  { x: 4.5, y: -1 },
  { x: 3.5, y: 2 },
];
const REST_ANGLE = [-28, -68, -112, -150, 28, 68, 112, 150].map((d) => (d * Math.PI) / 180);
const GROUP = [0, 1, 0, 1, 1, 0, 1, 0];

type LegMode = "planted" | "stepping" | "reaching" | "attached";
type Leg = { foot: Vec; from: Vec; to: Vec; t0: number; dur: number; mode: LegMode; usedAt: number; onDone?: () => void; holdUntil: number };

export type PageEntry = { index: number; url: string; status: number | null; blocks: Block[]; touches: Touch[]; complete: boolean };

export type StageEls = {
  viewport: HTMLDivElement;
  layer: HTMLDivElement;
  body: SVGGElement;
  legs: SVGPathElement[];
  knees: SVGCircleElement[];
  feet: SVGCircleElement[];
  reader: HTMLDivElement;
  chips: HTMLDivElement[];
};

type Phase = { name: "idle" } | { name: "approach"; touch: Touch; since: number } | { name: "reach"; touch: Touch } | { name: "dwell"; until: number } | { name: "exit"; until: number; next: number };

export class SpiderEngine {
  private pages = new Map<number, PageEntry>();
  private els: StageEls | null = null;
  private blockEls = new Map<string, HTMLElement>();
  private rects = new Map<string, Rect>();
  private shown: number | null = null;
  private requested: number | null = null;
  private played = 0;
  private phase: Phase = { name: "idle" };
  private ended = false;
  private raf = 0;
  private last = 0;
  private body: Vec = { x: 160, y: 160 };
  private target: Vec = { x: 160, y: 160 };
  private vel: Vec = { x: 0, y: 0 };
  private cam = 0;
  private legs: Leg[] = [];
  private l1 = 58;
  private l2 = 68;
  private width = 600;
  private height = 400;
  private viewH = 400;
  private touchCount = 0;
  private chipAt = 0;
  private focus: { y: number; until: number } | null = null;
  private userScrollUntil = 0;
  private dirty = true;
  /** "live": catch up with the crawl (faster when behind); "replay": steady pace; "pinned": a page shown statically. */
  mode: "live" | "replay" | "pinned" = "live";
  reduced = false;
  private liveCursor: number | null = null;
  private fast = false;

  constructor(
    private readonly onShow: (index: number | null) => void,
    private readonly onTouch?: (page: number, touch: Touch) => void,
  ) {
    this.legs = HIPS.map(() => ({ foot: { x: 0, y: 0 }, from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, t0: 0, dur: 0, mode: "planted", usedAt: 0, holdUntil: 0 }));
    this.plantAll();
  }

  /* ------------------------------------------------------------------ lifecycle */

  mount(els: StageEls) {
    this.els = els;
    this.measure();
    if (this.shown == null) {
      this.body = { x: this.width / 2, y: this.viewH * 0.42 };
      this.target = { ...this.body };
    }
    this.plantAll();
    const onUser = () => {
      this.userScrollUntil = performance.now() + 2500;
      if (this.mode === "pinned") this.focus = null;
    };
    els.viewport.addEventListener("wheel", onUser, { passive: true });
    els.viewport.addEventListener("touchstart", onUser, { passive: true });
    this.unbind = () => {
      els.viewport.removeEventListener("wheel", onUser);
      els.viewport.removeEventListener("touchstart", onUser);
    };
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }
  private unbind = () => {};
  destroy() {
    cancelAnimationFrame(this.raf);
    this.unbind();
    this.els = null;
  }

  reset() {
    this.pages.clear();
    this.shown = null;
    this.requested = null;
    this.played = 0;
    this.phase = { name: "idle" };
    this.ended = false;
    this.fast = false;
    this.liveCursor = null;
    this.mode = "live";
    this.blockEls.clear();
    this.rects.clear();
    this.body = { x: this.width / 2, y: this.viewH * 0.42 };
    this.target = { ...this.body };
    this.plantAll();
    this.setCam(0, true);
    this.onShow(null);
    this.dirty = true;
  }

  /* ------------------------------------------------------------------ data in */

  addPage(p: Omit<PageEntry, "touches" | "complete">) {
    this.pages.set(p.index, { ...p, touches: [], complete: false });
    if (this.mode !== "pinned" && this.shown == null && this.requested == null) this.request(p.index);
  }
  addTouch(page: number, touch: Touch) {
    this.pages.get(page)?.touches.push(touch);
    this.dirty = true;
  }
  completePage(page: number) {
    const p = this.pages.get(page);
    if (p) p.complete = true;
    this.dirty = true;
  }
  end() {
    this.ended = true;
    this.dirty = true;
  }
  /** Apply everything at once and jump to the newest page. */
  skip() {
    this.fast = true;
    this.dirty = true;
  }
  get pageCount() {
    return this.pages.size;
  }
  get latest() {
    return this.pages.size ? Math.max(...this.pages.keys()) : null;
  }
  /** Live playback still has pages or touches to show. */
  get behind() {
    const cur = this.mode === "pinned" ? this.liveCursor : this.shown;
    if (cur == null) return false;
    const p = this.pages.get(cur);
    return (this.latest ?? 0) > cur || (!!p && this.played < p.touches.length);
  }

  /** Show one page statically (all its touches applied) and optionally focus an element. */
  pin(index: number, blockId?: string | null) {
    if (this.mode !== "pinned") this.liveCursor = this.shown;
    this.mode = "pinned";
    this.pendingFocus = blockId ?? null;
    if (this.shown === index) {
      this.applyAll(index);
      if (blockId) this.focusBlock(blockId);
    } else this.request(index);
  }
  /** Back to the live playback (from where it was). */
  resume(mode: "live" | "replay" = "live") {
    const back = this.liveCursor ?? this.latest;
    this.mode = mode;
    this.liveCursor = null;
    if (back != null) this.request(back);
  }
  private pendingFocus: string | null = null;
  /** Bumped on every page attach so callbacks of an old page are ignored. */
  private gen = 0;

  /* ------------------------------------------------------------------ page DOM */

  private request(index: number) {
    this.requested = index;
    this.onShow(index);
  }

  /** Called by the stage after React rendered page `index` (its block elements are in the DOM). */
  attach(index: number, blockEls: Map<string, HTMLElement>) {
    this.shown = index;
    this.requested = null;
    this.gen++;
    this.blockEls = blockEls;
    for (const el of blockEls.values()) delete el.dataset.state;
    this.measure();
    this.phase = { name: "idle" };
    this.played = 0;
    this.focus = null;
    if (this.mode === "pinned") {
      this.applyAll(index);
      const f = this.pendingFocus;
      this.pendingFocus = null;
      if (f) this.focusBlock(f);
      else this.setCam(0, true);
    } else {
      // Enter from the top of the new page.
      this.body = { x: this.width * 0.5, y: -40 };
      this.target = { x: this.width * 0.5, y: 70 };
      this.plantAll();
      this.setCam(0, true);
    }
    this.dirty = true;
  }

  measure() {
    const els = this.els;
    if (!els) return;
    const base = els.layer.getBoundingClientRect();
    this.width = els.layer.clientWidth || 600;
    this.height = els.layer.scrollHeight || 400;
    this.viewH = els.viewport.clientHeight || 400;
    this.l1 = clamp(this.width * 0.085, 40, 62);
    this.l2 = this.l1 * 1.18;
    this.rects.clear();
    for (const [id, el] of this.blockEls) {
      const r = el.tagName === "SPAN" ? (el.getClientRects()[0] ?? el.getBoundingClientRect()) : el.getBoundingClientRect();
      this.rects.set(id, { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    }
    this.dirty = true;
  }

  private applyAll(index: number) {
    const p = this.pages.get(index);
    if (!p) return;
    for (const t of p.touches) this.apply(t, false);
  }

  private apply(t: Touch, visual: boolean) {
    const el = this.blockEls.get(t.blockId);
    if (el) el.dataset.state = t.action;
    if (visual && !this.reduced) this.flourish(t);
  }

  focusBlock(blockId: string) {
    const r = this.rects.get(blockId);
    const el = this.blockEls.get(blockId);
    if (!r) return;
    this.focus = { y: r.y + r.h / 2, until: performance.now() + (this.mode === "pinned" ? 1e9 : 2500) };
    if (this.reduced) this.setCam(r.y - this.viewH * 0.35, true);
    if (!this.reduced) el?.animate?.([{ outlineOffset: "8px" }, { outlineOffset: "2px" }], { duration: 600, iterations: 2 });
    if (this.mode === "pinned" && !this.reduced) {
      // Walk over and touch it.
      const anchor = { x: r.x + Math.min(r.w, 160) / 2, y: r.y + r.h / 2 };
      this.target = { x: clamp(anchor.x + this.reach * 0.55, 40, this.width - 40), y: anchor.y + this.reach * 0.3 };
      const leg = this.pickLeg(anchor);
      const p = nearestOnRect(this.hip(leg, this.target), r);
      this.startReach(leg, p, 420);
    }
    this.dirty = true;
  }

  /* ------------------------------------------------------------------ geometry */

  private get reach() {
    return this.l1 + this.l2;
  }
  private hip(i: number, body = this.body): Vec {
    return { x: body.x + HIPS[i].x, y: body.y + HIPS[i].y };
  }
  private rest(i: number, body = this.body): Vec {
    const h = this.hip(i, body);
    const r = this.reach * 0.86;
    return { x: h.x + Math.sin(REST_ANGLE[i]) * r, y: h.y - Math.cos(REST_ANGLE[i]) * r };
  }
  private plantAll() {
    this.legs.forEach((leg, i) => {
      leg.foot = this.rest(i);
      leg.mode = "planted";
      leg.onDone = undefined;
    });
  }
  private pickLeg(p: Vec): number {
    let best = 0;
    let bestScore = Infinity;
    const now = performance.now();
    this.legs.forEach((leg, i) => {
      if (leg.mode === "reaching") return;
      const side = (i < 4 ? -1 : 1) * (p.x - this.body.x) < -8 ? 60 : 0;
      const recent = now - leg.usedAt < 500 ? 45 : 0;
      const s = len(this.hip(i), p) + side + recent + (leg.mode === "stepping" ? 20 : 0);
      if (s < bestScore) {
        bestScore = s;
        best = i;
      }
    });
    return best;
  }
  private startReach(i: number, p: Vec, dur: number, onDone?: () => void) {
    const leg = this.legs[i];
    leg.from = { ...leg.foot };
    leg.to = p;
    leg.t0 = performance.now();
    leg.dur = dur;
    leg.mode = "reaching";
    leg.usedAt = leg.t0;
    leg.onDone = onDone;
  }

  /* ------------------------------------------------------------------ playback */

  /** Speed multiplier: catch up when the crawl is ahead of the animation. */
  private speed() {
    if (this.mode === "replay") return 2.2;
    if (this.mode === "pinned" || this.shown == null) return 1;
    const p = this.pages.get(this.shown);
    const pending = p ? p.touches.length - this.played : 0;
    const pagesAhead = (this.latest ?? this.shown) - this.shown;
    return clamp(1 + pending / 25 + pagesAhead * 1.2, 1, 7);
  }

  private step(now: number) {
    if (this.shown == null || this.mode === "pinned" || this.requested != null) return;
    const page = this.pages.get(this.shown);
    if (!page) return;
    const m = this.speed();
    const ahead = (this.latest ?? this.shown) - this.shown;
    // Far behind (or skipping / reduced motion): apply the rest of this page at once.
    if (this.fast || this.reduced || (this.mode === "live" && ahead >= 3)) {
      while (this.played < page.touches.length) {
        const t = page.touches[this.played++];
        this.apply(t, false);
        this.onTouch?.(page.index, t);
      }
      if (this.reduced && page.touches.length) {
        const r = this.rects.get(page.touches[page.touches.length - 1].blockId);
        if (r && now > this.userScrollUntil) this.setCam(r.y - this.viewH * 0.5, true);
      }
      this.phase = { name: "idle" };
    }
    const ph = this.phase;
    if (ph.name === "idle") {
      if (this.played < page.touches.length) {
        this.phase = { name: "approach", touch: page.touches[this.played], since: now };
        const r = this.rects.get(page.touches[this.played].blockId);
        if (r) {
          const anchor = { x: r.x + Math.min(r.w, 160) / 2, y: r.y + r.h / 2 };
          const d = len(anchor, this.body);
          if (d > this.reach * 0.92 || d < this.reach * 0.3) {
            const side = anchor.x < this.width * 0.55 ? 1 : -1;
            this.target = { x: clamp(anchor.x + side * this.reach * 0.55, 30, this.width - 30), y: anchor.y + this.reach * 0.32 };
          }
        }
      } else if ((page.complete || page.status == null || page.status >= 300) && this.pages.has(this.shown + 1)) {
        const dur = this.fast || this.reduced ? 0 : 650 / m;
        this.target = { x: this.width * 0.5, y: this.height + 80 };
        this.phase = { name: "exit", until: now + dur, next: this.shown + 1 };
      } else if (this.fast && page.complete && !this.pages.has(this.shown + 1)) this.fast = false;
    } else if (ph.name === "approach") {
      const r = this.rects.get(ph.touch.blockId);
      if (!r) {
        this.apply(ph.touch, false);
        this.onTouch?.(page.index, ph.touch);
        this.played++;
        this.phase = { name: "idle" };
        return;
      }
      const leg = this.pickLeg({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
      const p = nearestOnRect(this.hip(leg), r);
      const inReach = len(this.hip(leg), p) <= this.reach * 0.97;
      if (inReach || now - ph.since > 1400 / m) {
        const touch = ph.touch;
        const gen = this.gen;
        this.phase = { name: "reach", touch };
        this.startReach(leg, { x: p.x, y: p.y }, clamp(240 / m, 45, 240), () => {
          if (gen !== this.gen || this.phase.name !== "reach" || this.phase.touch !== touch) return;
          this.apply(touch, true);
          this.onTouch?.(page.index, touch);
          this.legs[leg].holdUntil = performance.now() + (touch.action === "flagged" ? 1400 : 700) / m;
          this.played++;
          this.phase = { name: "dwell", until: performance.now() + clamp((touch.action === "ok" ? 90 : 260) / m, 10, 260) };
        });
      }
    } else if (ph.name === "dwell") {
      if (now >= ph.until) this.phase = { name: "idle" };
    } else if (ph.name === "exit") {
      if (now >= ph.until) {
        this.phase = { name: "idle" };
        this.request(ph.next);
      }
    }
  }

  /** Visual extras on contact: a result chip by the foot and, now and then, the fragment enlarged. */
  private flourish(t: Touch) {
    const els = this.els;
    const r = this.rects.get(t.blockId);
    if (!els || !r) return;
    this.touchCount++;
    if (t.action !== "ok") {
      const chip = els.chips[this.chipAt++ % els.chips.length];
      chip.textContent = t.label;
      chip.style.color = t.action === "flagged" ? "var(--cs-flag)" : "var(--cs-fetched)";
      const x = clamp(r.x + r.w + 8, 4, Math.max(4, this.width - 200));
      chip.style.transform = `translate(${x}px, ${r.y - 18}px)`;
      chip.animate([{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: 1500, fill: "forwards" });
    }
    const block = this.blockEls.get(t.blockId);
    const text = block?.textContent?.trim() ?? "";
    if (text && (t.kind === "heading" || t.kind === "link") && (t.action === "flagged" || this.touchCount % 4 === 1)) {
      const reader = els.reader;
      reader.textContent = text.length > 34 ? `${text.slice(0, 33)}…` : text;
      reader.style.color = t.action === "flagged" ? "var(--cs-flag)" : "var(--cs-link)";
      const x = clamp(r.x - 6, 0, Math.max(0, this.width - 260));
      reader.style.left = `${x}px`;
      reader.style.top = `${r.y + r.h / 2 - 20}px`;
      reader.animate(
        [
          { opacity: 0, transform: "scale(0.6)" },
          { opacity: 0.95, transform: "scale(1)", offset: 0.25 },
          { opacity: 0.95, transform: "scale(1.04)", offset: 0.7 },
          { opacity: 0, transform: "scale(1.12)" },
        ],
        { duration: 1100, easing: "ease-out", fill: "forwards" },
      );
    }
  }

  /* ------------------------------------------------------------------ frame */

  private setCam(y: number, jump = false) {
    const max = Math.max(0, this.height - this.viewH);
    const v = clamp(y, 0, max);
    if (jump) {
      this.cam = v;
      if (this.els) this.els.viewport.scrollTop = v;
    } else this.camTarget = v;
  }
  private camTarget = 0;

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const els = this.els;
    if (!els) return;
    this.step(now);
    if (this.reduced) return;
    const m = this.speed();

    // Body: eased approach with a speed limit.
    const dx = this.target.x - this.body.x;
    const dy = this.target.y - this.body.y;
    const dist = Math.hypot(dx, dy);
    const moving = dist > 0.5;
    if (moving) {
      const maxStep = 340 * m * dt;
      const k = Math.min(1, (1 - Math.exp(-dt * 6)) * Math.max(1, m * 0.6));
      let sx = dx * k;
      let sy = dy * k;
      const s = Math.hypot(sx, sy);
      if (s > maxStep) {
        sx *= maxStep / s;
        sy *= maxStep / s;
      }
      this.vel = { x: sx / Math.max(dt, 0.001), y: sy / Math.max(dt, 0.001) };
      this.body = { x: this.body.x + sx, y: this.body.y + sy };
    } else this.vel = { x: 0, y: 0 };

    // Legs: reaching legs ease to their target; attached legs hold; the rest re-plant in a gait.
    const stepping = [false, false];
    this.legs.forEach((leg, i) => {
      if (leg.mode === "stepping") stepping[GROUP[i]] = true;
    });
    let animating = moving;
    this.legs.forEach((leg, i) => {
      if (leg.mode === "reaching" || leg.mode === "stepping") {
        animating = true;
        const t = clamp((now - leg.t0) / leg.dur, 0, 1);
        const e = leg.mode === "reaching" ? easeOut(t) : easeInOut(t);
        const lift = leg.mode === "stepping" ? Math.sin(t * Math.PI) * 6 : 0;
        leg.foot = { x: lerp(leg.from.x, leg.to.x, e), y: lerp(leg.from.y, leg.to.y, e) - lift };
        if (t >= 1) {
          leg.foot = { ...leg.to };
          const done = leg.onDone;
          leg.onDone = undefined;
          leg.mode = leg.mode === "reaching" ? "attached" : "planted";
          done?.();
        }
        return;
      }
      const restP = this.rest(i);
      const far = len(leg.foot, this.hip(i)) > this.reach * 0.98;
      const drift = len(leg.foot, restP) > this.reach * 0.42;
      const release = leg.mode === "attached" && now > leg.holdUntil && (drift || far);
      if ((leg.mode === "planted" && (drift || far) && !stepping[1 - GROUP[i]]) || release || (leg.mode === "attached" && far)) {
        leg.mode = "stepping";
        leg.from = { ...leg.foot };
        leg.to = { x: restP.x + this.vel.x * 0.16, y: restP.y + this.vel.y * 0.16 };
        leg.t0 = now;
        leg.dur = clamp(170 / Math.sqrt(m), 70, 170);
        stepping[GROUP[i]] = true;
        animating = true;
      }
    });

    // Camera follows the body (or a focused element), unless the user is scrolling.
    const focused = this.focus && now < this.focus.until;
    const following = focused || (this.mode !== "pinned" && (this.phase.name !== "idle" || moving));
    if (now > this.userScrollUntil && following) {
      this.setCam((focused ? this.focus!.y : this.body.y) - this.viewH * 0.42);
      const prev = this.cam;
      this.cam += (this.camTarget - this.cam) * (1 - Math.exp(-dt * 5));
      if (Math.abs(this.cam - prev) > 0.3) {
        els.viewport.scrollTop = this.cam;
        animating = true;
      }
    } else if (!following || now <= this.userScrollUntil) this.cam = els.viewport.scrollTop;

    if (!animating && !this.dirty) return;
    this.dirty = false;
    this.draw(els);
  };

  private draw(els: StageEls) {
    els.body.setAttribute("transform", `translate(${this.body.x.toFixed(1)} ${this.body.y.toFixed(1)})`);
    this.legs.forEach((leg, i) => {
      const hip = this.hip(i);
      // Knees bend outward: away from a point on the opposite side of the body.
      const away = { x: this.body.x + (i < 4 ? 14 : -14), y: this.body.y };
      const { knee, foot } = solveLeg(hip, leg.foot, this.l1, this.l2, away);
      els.legs[i].setAttribute("d", `M${hip.x.toFixed(1)} ${hip.y.toFixed(1)}L${knee.x.toFixed(1)} ${knee.y.toFixed(1)}L${foot.x.toFixed(1)} ${foot.y.toFixed(1)}`);
      els.knees[i].setAttribute("cx", knee.x.toFixed(1));
      els.knees[i].setAttribute("cy", knee.y.toFixed(1));
      els.feet[i].setAttribute("cx", foot.x.toFixed(1));
      els.feet[i].setAttribute("cy", foot.y.toFixed(1));
    });
  }
}
