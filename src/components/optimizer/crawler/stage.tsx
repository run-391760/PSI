"use client";

import { ImageIcon } from "lucide-react";
import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { Block, Touch } from "@/lib/optimizer/crawl/types";
import { cn } from "@/lib/utils";
import s from "./crawler.module.css";
import { type PageEntry, SpiderEngine, type StageEls } from "./spider";

/**
 * The live stage: a dark panel that renders the crawled page's real text (head facts, headings,
 * paragraphs with inline links, lists, images as placeholders, tables) with the spider overlaid.
 * The parent feeds it events through the imperative handle; the engine paces the animation and
 * asks the stage which page to render. With prefers-reduced-motion the spider is hidden and the
 * outlines appear directly.
 */

export type StageHandle = {
  reset: () => void;
  addPage: (p: Omit<PageEntry, "touches" | "complete"> & { title: string; error: string | null; ttfbMs: number | null }) => void;
  addTouch: (page: number, touch: Touch) => void;
  completePage: (page: number) => void;
  end: () => void;
  skip: () => void;
  /** Show a page statically, optionally scrolled to one element. */
  pin: (page: number, blockId?: string | null) => void;
  resume: (mode: "live" | "replay") => void;
};

type Snapshot = { index: number; url: string; status: number | null; title: string; error: string | null; ttfbMs: number | null; blocks: Block[] };

const LEGS = [0, 1, 2, 3, 4, 5, 6, 7];

export function CrawlStage({ ref, total, running, replaying, onShownChange, className }: { ref?: Ref<StageHandle>; total: number; running: boolean; replaying: boolean; onShownChange?: (index: number | null) => void; className?: string }) {
  const snapshots = useRef(new Map<number, Snapshot>());
  const [shown, setShown] = useState<{ index: number | null; n: number }>({ index: null, n: 0 });
  // Pinned: a page is shown statically; `behind` = live playback still has more to show.
  const [pinned, setPinned] = useState<{ behind: boolean } | null>(null);
  const [reduced, setReduced] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const svgBody = useRef<SVGGElement>(null);
  const legs = useRef<(SVGPathElement | null)[]>([]);
  const knees = useRef<(SVGCircleElement | null)[]>([]);
  const feet = useRef<(SVGCircleElement | null)[]>([]);
  const reader = useRef<HTMLDivElement>(null);
  const chips = useRef<(HTMLDivElement | null)[]>([]);
  const lastTouch = useRef<HTMLSpanElement>(null);
  const engine = useRef<SpiderEngine | null>(null);
  const shownChange = useRef(onShownChange);
  useEffect(() => {
    shownChange.current = onShownChange;
  });

  // The engine lives as long as the stage; it calls back to choose the rendered page.
  useEffect(() => {
    const e = new SpiderEngine(
      (index) => setShown((cur) => ({ index, n: cur.n + 1 })),
      (_page, t) => {
        if (lastTouch.current) lastTouch.current.textContent = t.label;
      },
    );
    engine.current = e;
    const els: StageEls = {
      viewport: viewport.current!,
      layer: layer.current!,
      body: svgBody.current!,
      legs: legs.current as SVGPathElement[],
      knees: knees.current as SVGCircleElement[],
      feet: feet.current as SVGCircleElement[],
      reader: reader.current!,
      chips: chips.current as HTMLDivElement[],
    };
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      e.reduced = mq.matches;
      setReduced(mq.matches);
    };
    sync();
    mq.addEventListener("change", sync);
    e.mount(els);
    const ro = new ResizeObserver(() => e.measure());
    ro.observe(viewport.current!);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", sync);
      e.destroy();
      engine.current = null;
    };
  }, []);

  // After React rendered a page, hand its elements to the engine (layout is read once here).
  useLayoutEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (shown.index == null) {
      e.measure();
      shownChange.current?.(null);
      return;
    }
    const map = new Map<string, HTMLElement>();
    layer.current?.querySelectorAll<HTMLElement>("[data-bid]").forEach((el) => map.set(el.dataset.bid!, el));
    e.attach(shown.index, map);
    if (lastTouch.current) lastTouch.current.textContent = "";
    shownChange.current?.(shown.index);
  }, [shown]);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        snapshots.current.clear();
        setPinned(null);
        engine.current?.reset();
      },
      addPage: (p) => {
        snapshots.current.set(p.index, { index: p.index, url: p.url, status: p.status, title: p.title, error: p.error, ttfbMs: p.ttfbMs, blocks: p.blocks });
        engine.current?.addPage(p);
      },
      addTouch: (page, t) => engine.current?.addTouch(page, t),
      completePage: (page) => engine.current?.completePage(page),
      end: () => engine.current?.end(),
      skip: () => engine.current?.skip(),
      pin: (page, blockId) => {
        const e = engine.current;
        if (!snapshots.current.has(page) || !e) return;
        setPinned((cur) => cur ?? { behind: e.behind });
        e.pin(page, blockId);
      },
      resume: (mode) => {
        setPinned(null);
        engine.current?.resume(mode);
      },
    }),
    [],
  );

  const snap = shown.index != null ? snapshots.current.get(shown.index) : undefined;
  const live = running || replaying;
  return (
    <div className={cn(s.stage, className)}>
      <div className={s.bar}>
        {snap ? (
          <>
            <span className={s.pill}>
              {snap.index + 1}
              {total ? `/${total}` : ""}
            </span>
            <span className={s.barUrl} title={snap.url}>
              {snap.url.replace(/^https?:\/\//, "")}
            </span>
            <span className={cn(s.pill, (snap.status ?? 0) >= 400 || snap.status == null ? s.pillBad : undefined)}>{snap.status ?? "ERR"}</span>
            {snap.ttfbMs != null && <span className={cn(s.pill, "hidden sm:inline")}>TTFB {snap.ttfbMs} ms</span>}
          </>
        ) : (
          <span className={s.barUrl}>SynapseSEOBot · waiting for a URL</span>
        )}
        {pinned ? (
          live || pinned.behind ? (
            <button type="button" className={s.barButton} onClick={() => (setPinned(null), engine.current?.resume(replaying ? "replay" : "live"))}>
              Back to live
            </button>
          ) : null
        ) : live ? (
          <button type="button" className={s.barButton} onClick={() => engine.current?.skip()} title="Show the results without the animation">
            Skip animation
          </button>
        ) : null}
      </div>

      <div ref={viewport} className={s.viewport}>
        <div ref={layer} className={s.layer}>
          <div className={s.doc}>{snap ? <Snapshot snap={snap} /> : null}</div>
          <svg className={s.overlay} aria-hidden style={{ display: reduced ? "none" : undefined }}>
            <g className={s.legs}>
              {LEGS.map((i) => (
                <path key={i} ref={(el) => void (legs.current[i] = el)} />
              ))}
            </g>
            {LEGS.map((i) => (
              <circle key={`k${i}`} ref={(el) => void (knees.current[i] = el)} r={1.8} className={s.knee} />
            ))}
            {LEGS.map((i) => (
              <circle key={`f${i}`} ref={(el) => void (feet.current[i] = el)} r={2.6} className={s.foot} />
            ))}
            <g ref={svgBody}>
              <ellipse cx={0} cy={6} rx={6} ry={8.5} className={s.body} />
              <circle cx={0} cy={-5} r={4.6} className={s.body} />
              <rect x={-1.6} y={-7} width={3.2} height={2.6} className={s.eye} />
            </g>
          </svg>
          <div ref={reader} className={s.reader} aria-hidden />
          {[0, 1, 2].map((i) => (
            <div key={i} ref={(el) => void (chips.current[i] = el)} className={s.chip} aria-hidden />
          ))}
        </div>
        {!snap && <p className={s.intro}>Enter a website URL and start the crawl: the spider walks each page and reaches for every link, heading and image it checks.</p>}
      </div>

      <div className={s.legend}>
        <span style={{ color: "var(--cs-fetched)" }}>
          <i />
          Fetched link
        </span>
        <span style={{ color: "var(--cs-flag)" }}>
          <i />
          Flagged issue
        </span>
        <span style={{ color: "var(--cs-ok)" }}>
          <i />
          Checked, OK
        </span>
        <span className="ml-auto min-w-0 truncate" ref={lastTouch} aria-live="polite" />
      </div>
    </div>
  );
}

/** The page snapshot as real text. Every inspectable element carries data-bid for the engine. */
function Snapshot({ snap }: { snap: Snapshot }) {
  if ((snap.status ?? 0) >= 300 || snap.status == null || !snap.blocks.length)
    return (
      <div className={s.errorPage}>
        <div className={s.errorCode}>{snap.status ?? "ERR"}</div>
        <p className="mt-1 break-all">{snap.url}</p>
        <p className="mt-2">{snap.error ?? ((snap.status ?? 0) >= 300 && (snap.status ?? 0) < 400 ? "Redirect not followed." : snap.blocks.length ? "" : "No readable content in the HTML.")}</p>
      </div>
    );
  const links = new Map(snap.blocks.filter((b) => b.tag === "a" && b.parent).map((b) => [b.id, b]));
  const out: React.ReactNode[] = [];
  for (const b of snap.blocks) {
    if (b.parent) continue;
    out.push(<BlockView key={b.id} b={b} links={links} />);
    if (b.tag === "head") out.push(<div key="sep" className={s.headSep} />);
  }
  return <>{out}</>;
}

function Segs({ b, links }: { b: Block; links: Map<string, Block> }) {
  if (!b.segs) return <>{b.text}</>;
  return (
    <>
      {b.segs.map((sg, i) => {
        if (!sg.a) return <span key={i}>{sg.t}</span>;
        const l = links.get(sg.a);
        return (
          <span key={i} data-bid={sg.a} className={cn(s.a, !sg.t && s.aEmpty)} title={l?.href}>
            {sg.t || "empty link"}
          </span>
        );
      })}
    </>
  );
}

function BlockView({ b, links }: { b: Block; links: Map<string, Block> }) {
  switch (b.tag) {
    case "title":
      return (
        <div data-bid={b.id} className={cn(s.block, s.mono)}>
          &lt;title&gt;<b>{b.text || " "}</b>&lt;/title&gt;
        </div>
      );
    case "meta":
      return (
        <div data-bid={b.id} className={cn(s.block, s.mono)}>
          &lt;meta name=&quot;description&quot; content=&quot;<b>{b.text}</b>&quot;&gt;
        </div>
      );
    case "head":
      return (
        <div data-bid={b.id} className={cn(s.block, s.mono)}>
          {b.text}
        </div>
      );
    case "h1":
    case "h2":
    case "h3": {
      const cls = b.tag === "h1" ? s.h1 : b.tag === "h2" ? s.h2 : s.h3;
      return (
        <div data-bid={b.id} className={cn(s.block, cls)} role="heading" aria-level={b.level ?? Number(b.tag[1])}>
          {b.text ? <Segs b={b} links={links} /> : <span className={s.empty}>(empty H{b.level ?? b.tag[1]})</span>}
          {b.level && b.level > 3 ? <span className={cn(s.empty, "ml-2 text-[11px]")}>H{b.level}</span> : null}
        </div>
      );
    }
    case "li":
      return (
        <div data-bid={b.id} className={cn(s.block, s.li, b.ordered && s.liNum)}>
          <Segs b={b} links={links} />
        </div>
      );
    case "a":
      return (
        <div>
          <span data-bid={b.id} className={cn(s.a, s.aBlock, !b.text && s.aEmpty)} title={b.href}>
            {b.text || "empty link"}
          </span>
        </div>
      );
    case "img":
      return (
        <div data-bid={b.id} className={cn(s.block, s.img)} title={b.src}>
          <ImageIcon className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{b.alt === null ? "img · no alt attribute" : b.alt ? `alt: ${b.text}` : 'alt=""'}</span>
        </div>
      );
    case "table":
      return (
        <div data-bid={b.id} className={cn(s.block, s.table)}>
          <table>
            {b.text && b.text !== b.rows?.[0]?.join(" · ") && <caption>{b.text}</caption>}
            <tbody>
              {(b.rows ?? []).map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return (
        <p data-bid={b.id} className={cn(s.block, s.p)}>
          <Segs b={b} links={links} />
        </p>
      );
  }
}
