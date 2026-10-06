import { ChevronRight, CircleCheck, CircleDashed, Database, ExternalLink, KeyRound, Sparkles } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import type { CredentialStatus, Workspace } from "@/lib/integrations/registry";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = { llm: boolean; llmLabel: string | null; items: CredentialStatus[] };

const code = "rounded border border-border bg-surface-2 px-1 py-px font-mono text-[11px] text-text break-all";

/**
 * "API keys & where they're used": every credential from src/lib/integrations/registry.ts with its
 * status, the variables to set and the features it powers in each workspace. Shown on SEO Settings →
 * Integrations and CX Settings → Integrated Apps. Receives flags only, never values.
 */
export function ApiKeyMap({ status, workspace = "SEO", brandId, className }: { status: Status; workspace?: Workspace; brandId?: string; className?: string }) {
  const uses = (c: CredentialStatus, w: Workspace) => c.powers.some((p) => p.workspace === w);
  // The current workspace's credentials first; stable order otherwise.
  const ordered = [...status.items].sort((a, b) => Number(uses(b, workspace)) - Number(uses(a, workspace)));
  const sections = [
    { id: "keys", title: "Server keys", items: ordered.filter((c) => c.storage === "env" && c.kind !== "internal") },
    { id: "saved", title: "Saved in the app", items: ordered.filter((c) => c.storage === "db") },
    { id: "internal", title: "Server settings", items: ordered.filter((c) => c.kind === "internal") },
  ];
  const keys = sections[0].items.filter((c) => c.kind === "key");
  const on = keys.filter((c) => c.configured).length;
  const order: Workspace[] = workspace === "CX" ? ["CX", "SEO"] : ["SEO", "CX"];
  const href = (h: string, w: Workspace) => (brandId && w === "CX" ? `${h}${h.includes("?") ? "&" : "?"}brand=${brandId}` : h);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-text-2">
        <span>
          <span className="font-semibold text-text">{on}</span> of {keys.length} server keys configured
        </span>
        <p className="flex min-w-0 items-start gap-1.5">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-3" />
          <span className="min-w-0">
            {status.llm ? (
              <>AI writing features use <span className="font-medium text-text">{status.llmLabel ?? "the configured AI key"}</span></>
            ) : (
              <>
                AI writing features need one of{" "}
                {["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"].map((v, i) => (
                  <Fragment key={v}>
                    {i > 0 && " or "}
                    <code className={cn(code, "break-normal whitespace-nowrap")}>{v}</code>
                  </Fragment>
                ))}
              </>
            )}
          </span>
        </p>
      </div>
      {sections.map((s) =>
        s.items.length ? (
          <section key={s.id} className="overflow-hidden rounded-md border border-border">
            <h3 className="border-b border-border bg-surface-2 px-3 py-1.5 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">{s.title}</h3>
            <ul className="divide-y divide-border">
              {s.items.map((c) => (
                <li key={c.id}>
                  <Row c={c} href={href} order={order} />
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
      <p className="flex items-start gap-1.5 text-[12px] text-text-3">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Server keys are environment variables read on the server; restart after changing them. Values are never shown.
      </p>
    </div>
  );
}

function Row({ c, href, order }: { c: CredentialStatus; href: (h: string, w: Workspace) => string; order: Workspace[] }) {
  const tone = c.configured == null ? "info" : c.configured ? "good" : c.unsetOk ? "neutral" : "warning";
  const count = (w: Workspace) => c.powers.filter((p) => p.workspace === w).length;
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-3 transition-transform group-open:rotate-90" />
        {c.configured == null ? (
          <Database className="h-4 w-4 shrink-0 text-link" aria-hidden />
        ) : c.configured ? (
          <CircleCheck className="h-4 w-4 shrink-0 text-good-ink" aria-hidden />
        ) : (
          <CircleDashed className="h-4 w-4 shrink-0 text-text-3" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-text">{c.label}</span>
          <span className="block truncate text-[11.5px] text-text-3">
            {c.provider}
            {order.map((w) => (count(w) ? ` · ${w} ${count(w)}` : ""))}
          </span>
        </span>
        <Badge tone={tone} className="max-w-[45%] truncate">
          <span className="truncate">{c.statusLabel}</span>
        </Badge>
      </summary>
      <div className="space-y-2 px-3 pb-3 pl-9 text-[12.5px] text-text-2">
        {c.env.length > 0 && (
          <p>
            <span className="text-text-3">{c.env.length > 1 ? "Set any one: " : "Set: "}</span>
            {c.env.map((g, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="mx-1 text-text-3">or</span>}
                {g.map((v, j) => (
                  <Fragment key={v.name}>
                    {j > 0 && <span className="mx-0.5 text-text-3">+</span>}
                    <code className={code} title={v.set ? "Set" : "Not set"}>
                      {v.name}
                      {v.set && <span className="ml-1 text-good-ink">✓</span>}
                    </code>
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </p>
        )}
        {c.optional.length > 0 && (
          <p>
            <span className="text-text-3">Optional: </span>
            {c.optional.map((v) => (
              <code key={v.name} className={cn(code, "mr-1 inline-block")}>
                {v.name}
                {v.set && <span className="ml-1 text-good-ink">✓</span>}
              </code>
            ))}
          </p>
        )}
        {c.savedAt && (
          <p>
            <span className="text-text-3">Saved per {c.savedAt.workspace === "CX" ? "brand" : "user"} in </span>
            <Link href={href(c.savedAt.href, c.savedAt.workspace)} className="text-link hover:underline">
              {c.savedAt.workspace} · {c.savedAt.label}
            </Link>
            <span className="text-text-3"> (encrypted with APP_SECRET)</span>
          </p>
        )}
        {c.hint && <p className={c.unsetOk ? "text-text-3" : "text-warning-ink"}>{c.hint}</p>}
        {order.map((w) => {
          const list = c.powers.filter((p) => p.workspace === w);
          return list.length ? (
            <div key={w} className="flex flex-wrap items-center gap-1.5">
              <span className={cn("w-8 shrink-0 text-[11px] font-semibold", w === "SEO" ? "text-brand-ink" : "text-link")}>{w}</span>
              {list.map((p) => (
                <Link key={`${p.href}${p.feature}`} href={href(p.href, w)} className="rounded bg-surface-3 px-1.5 py-0.5 text-[11.5px] text-text-2 hover:text-link hover:underline">
                  {p.feature}
                </Link>
              ))}
            </div>
          ) : null;
        })}
        {(c.note || c.docs) && (
          <p className="text-[12px] text-text-3">
            {c.note}
            {c.docs && (
              <a href={c.docs} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-link hover:underline">
                Docs <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </p>
        )}
      </div>
    </details>
  );
}
