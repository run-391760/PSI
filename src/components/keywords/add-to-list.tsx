"use client";

import { ListPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { addKeywordsAction, createListAction, listKeywordListsAction } from "@/app/(app)/keyword-strategy/actions";
import { database } from "@/lib/domain";
import { compact } from "@/lib/format";
import type { KeywordList } from "@/lib/keywords/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout, Spinner } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";

type Result = { id: string; name: string; added: number; skipped: number };

/**
 * Dialog that adds keywords to an existing keyword list or a new one (Keyword Strategy Builder).
 * Used by Keyword Overview, Keyword Magic Tool, Topic Research and the ?import= flow.
 */
export function AddToListDialog({
  open,
  onClose,
  keywords,
  db,
  defaultName,
  from = "manual",
  onAdded,
  navigate,
}: {
  open: boolean;
  onClose: () => void;
  keywords: string[];
  db: string;
  defaultName?: string;
  from?: string;
  onAdded?: (r: Result) => void;
  /** Navigate to the list after adding (instead of showing a success message). */
  navigate?: boolean;
}) {
  const router = useRouter();
  const [lists, setLists] = useState<KeywordList[] | null>(null);
  const [target, setTarget] = useState<string>("new");
  const [name, setName] = useState(defaultName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setDone(null);
    setError(null);
    setName(defaultName ?? "");
    let alive = true;
    listKeywordListsAction().then((res) => {
      if (!alive) return;
      if (!res.ok) return setError(res.error);
      setLists(res.data);
      setTarget(res.data.length ? res.data[0].id : "new");
    });
    return () => {
      alive = false;
    };
  }, [open, defaultName]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      if (target === "new") {
        const res = await createListAction({ name, db, keywords, from });
        if (!res.ok) return setError(res.error);
        finish({ id: res.data.id, name, added: res.data.added, skipped: res.data.skipped });
      } else {
        const res = await addKeywordsAction(target, keywords, from);
        if (!res.ok) return setError(res.error);
        finish({ id: target, name: lists?.find((l) => l.id === target)?.name ?? "list", added: res.data.added, skipped: res.data.skipped });
      }
    });
  };
  const finish = (r: Result) => {
    onAdded?.(r);
    // Navigate without calling onClose: the caller's onClose may itself navigate (e.g. clear ?import=).
    if (navigate) router.push(`/keyword-strategy?list=${r.id}`);
    else setDone(r);
  };

  const chosen = lists?.find((l) => l.id === target);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add to keyword list"
      description={`${keywords.length.toLocaleString()} keyword${keywords.length === 1 ? "" : "s"} · ${database(db).flag} ${database(db).name}`}
      footer={
        done ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Link href={`/keyword-strategy?list=${done.id}`} className="inline-flex h-8.5 items-center rounded-md bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-brand-hover" onClick={onClose}>
              Open list
            </Link>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="add-to-list-form" loading={pending} disabled={!keywords.length || (target === "new" && !name.trim())}>
              Add {keywords.length > 1 ? `${keywords.length.toLocaleString()} keywords` : "keyword"}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Callout tone="good" title={`Added to “${done.name}”`}>
          {done.added.toLocaleString()} new keyword{done.added === 1 ? "" : "s"} added{done.skipped ? `, ${done.skipped.toLocaleString()} already in the list` : ""}.
        </Callout>
      ) : (
        <form id="add-to-list-form" onSubmit={submit} className="space-y-3">
          {error && <Callout tone="critical">{error}</Callout>}
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-text-2">
            <span className="line-clamp-2">{keywords.slice(0, 12).join(", ")}{keywords.length > 12 ? ` and ${keywords.length - 12} more` : ""}</span>
          </div>
          {lists === null ? (
            <div className="flex items-center gap-2 py-3 text-[13px] text-text-3">
              <Spinner /> Loading your lists…
            </div>
          ) : (
            <div className="scroll-thin max-h-64 space-y-1 overflow-y-auto" role="radiogroup" aria-label="Keyword list">
              {lists.map((l) => (
                <label key={l.id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-[13px]", target === l.id ? "border-brand bg-brand-soft/50" : "border-border hover:bg-surface-2")}>
                  <input type="radio" name="list" value={l.id} checked={target === l.id} onChange={() => setTarget(l.id)} className="accent-[var(--brand)]" />
                  <span className="min-w-0 flex-1 truncate font-medium text-text">{l.name}</span>
                  <span className="shrink-0 text-[12px] text-text-3">
                    {database(l.db).flag} {l.keywords.toLocaleString()} kw · {compact(l.volume)} vol
                  </span>
                </label>
              ))}
              <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-[13px]", target === "new" ? "border-brand bg-brand-soft/50" : "border-border hover:bg-surface-2")}>
                <input type="radio" name="list" value="new" checked={target === "new"} onChange={() => setTarget("new")} className="accent-[var(--brand)]" />
                <span className="shrink-0 font-medium text-text">New list</span>
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setTarget("new");
                  }}
                  placeholder="List name"
                  aria-label="New list name"
                  maxLength={80}
                  className="h-7.5"
                />
              </label>
            </div>
          )}
          {chosen && chosen.db !== database(db).code && (
            <p className="text-[12px] text-text-3">
              This list uses the {database(chosen.db).flag} {database(chosen.db).name} database; metrics will be fetched for that market.
            </p>
          )}
        </form>
      )}
    </Dialog>
  );
}

/** Button + dialog. */
export function AddToListButton({
  keywords,
  db,
  defaultName,
  from,
  label = "Add to list",
  variant = "secondary",
  size = "md",
  className,
}: {
  keywords: string[];
  db: string;
  defaultName?: string;
  from?: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} disabled={!keywords.length} className={className}>
        <ListPlus className="h-4 w-4" /> {label}
      </Button>
      <AddToListDialog open={open} onClose={() => setOpen(false)} keywords={keywords} db={db} defaultName={defaultName} from={from} />
    </>
  );
}
