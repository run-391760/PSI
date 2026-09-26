"use client";

import { Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { createDocumentAction, deleteDocumentAction, duplicateDocumentAction, renameDocumentAction } from "@/app/(app)/writing-assistant/actions";
import { DATABASES } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Dialog, Menu, MenuItem } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/input";

export type DocListRow = { id: string; title: string; keywords: string[]; words: number; score: number; updated_at: string; created_at: string };

function ScorePill({ score, words }: { score: number; words: number }) {
  if (!words) return <span className="text-text-3">–</span>;
  const tone = score >= 8 ? "good" : score >= 6 ? "warning" : score >= 4 ? "serious" : "critical";
  return <Badge tone={tone}>{score.toFixed(1)}</Badge>;
}

export function NewDocumentButton({ label = "New document", variant = "primary" }: { label?: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const keywords = String(f.get("keywords") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (keywords.length > 10) return setError("Use at most 10 target keywords.");
    start(async () => {
      const res = await createDocumentAction({ title: String(f.get("title") || ""), keywords, db: String(f.get("db") || "US") });
      if (!res.ok) return setError(res.error);
      router.push(`/writing-assistant/${res.data.id}`);
    });
  };
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New document" description="Target keywords set length, readability and recommended-keyword targets from the top 10 (demo data).">
        <form onSubmit={submit} className="space-y-3.5">
          {error && <Callout tone="critical">{error}</Callout>}
          <Field label="Title" htmlFor="wa-new-title">
            <Input id="wa-new-title" name="title" placeholder="e.g. How to choose running shoes" maxLength={200} autoFocus />
          </Field>
          <Field label="Target keywords" hint="Comma separated, up to 10. The first is the main keyword." htmlFor="wa-new-kw">
            <Input id="wa-new-kw" name="keywords" placeholder="running shoes, best running shoes" />
          </Field>
          <Field label="Database" htmlFor="wa-new-db">
            <Select id="wa-new-db" name="db" defaultValue="US">
              {DATABASES.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.flag} {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Create document
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function DocList({ rows }: { rows: DocListRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rename, setRename] = useState<DocListRow | null>(null);
  const [confirm, setConfirm] = useState<DocListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else after?.();
      router.refresh();
    });

  const columns: Column<DocListRow>[] = [
    {
      key: "title",
      header: "Document",
      render: (r) => (
        <Link href={`/writing-assistant/${r.id}`} className="block max-w-[420px] min-w-[180px] truncate font-medium text-link hover:underline">
          {r.title}
        </Link>
      ),
    },
    {
      key: "keywords",
      header: "Target keywords",
      sortValue: (r) => r.keywords.join(", "),
      csv: (r) => r.keywords.join("; "),
      render: (r) =>
        r.keywords.length ? (
          <span className="flex max-w-[320px] flex-wrap gap-1">
            {r.keywords.slice(0, 3).map((k) => (
              <Badge key={k}>{k}</Badge>
            ))}
            {r.keywords.length > 3 && <span className="text-[11.5px] text-text-3">+{r.keywords.length - 3}</span>}
          </span>
        ) : (
          <span className="text-text-3">–</span>
        ),
    },
    { key: "words", header: "Words", align: "right", render: (r) => r.words.toLocaleString("en-US") },
    { key: "score", header: "Score", align: "right", info: "Overall score 0–10 at the last save.", render: (r) => <ScorePill score={r.score} words={r.words} /> },
    { key: "updated_at", header: "Last edited", align: "right", render: (r) => <span className="text-text-2">{timeAgo(r.updated_at)}</span>, sortValue: (r) => r.updated_at },
    {
      key: "menu",
      header: "",
      sortable: false,
      noExport: true,
      render: (r) => (
        <Menu
          align="right"
          trigger={() => (
            <button type="button" className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text" aria-label={`Actions for ${r.title}`}>
              <MoreHorizontal className="h-4 w-4" />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => (setRename(r), close())}>
                Rename
              </MenuItem>
              <MenuItem
                icon={<Copy className="h-3.5 w-3.5" />}
                onClick={() => {
                  close();
                  run(() => duplicateDocumentAction(r.id));
                }}
              >
                Duplicate
              </MenuItem>
              <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => (setConfirm([r]), close())}>
                Delete
              </MenuItem>
            </>
          )}
        </Menu>
      ),
    },
  ];

  return (
    <>
      {error && <Callout tone="critical" className="mx-4 mb-3">{error}</Callout>}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        defaultSort={{ key: "updated_at", dir: "desc" }}
        searchable
        searchPlaceholder="Filter documents"
        searchText={(r) => `${r.title} ${r.keywords.join(" ")}`}
        selectable
        exportName="writing-assistant-documents"
        selectionActions={(sel) => (
          <Button size="sm" variant="danger" onClick={() => setConfirm(sel)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete {sel.length}
          </Button>
        )}
      />
      <Dialog
        open={!!rename}
        onClose={() => setRename(null)}
        title="Rename document"
        size="sm"
      >
        {rename && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const title = String(new FormData(e.currentTarget).get("title") || "");
              run(() => renameDocumentAction(rename.id, title), () => setRename(null));
            }}
            className="space-y-3"
          >
            <Input name="title" defaultValue={rename.title} maxLength={200} autoFocus aria-label="Title" />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRename(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={pending}>
                Save
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm && confirm.length > 1 ? `Delete ${confirm.length} documents?` : "Delete document?"}
        description="This can't be undone."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={pending} onClick={() => confirm && run(() => deleteDocumentAction(confirm.map((c) => c.id)), () => setConfirm(null))}>
              Delete
            </Button>
          </>
        }
      >
        <ul className="space-y-1 text-[13px] text-text-2">
          {confirm?.slice(0, 5).map((c) => (
            <li key={c.id} className="truncate">
              {c.title}
            </li>
          ))}
          {confirm && confirm.length > 5 && <li>…and {confirm.length - 5} more</li>}
        </ul>
      </Dialog>
    </>
  );
}
