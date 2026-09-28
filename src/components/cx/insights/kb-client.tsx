"use client";

import { FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteArticleAction, deleteCategoryAction, saveArticleAction, saveCategoryAction } from "@/app/(app)/cx/knowledge/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";

type Cat = { id: string; parent_id: string | null; name: string; articles: number };
type Art = { id: string; title: string; body: string; category_id: string | null; tags: string[]; status: "draft" | "published" };

const catOptions = (cats: Cat[]) =>
  cats.filter((c) => !c.parent_id).flatMap((p) => [
    <option key={p.id} value={p.id}>{p.name}</option>,
    ...cats.filter((c) => c.parent_id === p.id).map((c) => <option key={c.id} value={c.id}>{`   ${p.name} › ${c.name}`}</option>),
  ]);

export function ArticleButton({ brand, cats, article, defaultCategory, variant = "primary" }: { brand: string; cats: Cat[]; article?: Art; defaultCategory?: string | null; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [a, setA] = useState<Art>(article ?? { id: "", title: "", body: "", category_id: defaultCategory ?? null, tags: [], status: "published" });
  const [tags, setTags] = useState((article?.tags ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant={variant} size={article ? "sm" : "md"} onClick={() => setOpen(true)}>
        {article ? <><Pencil className="h-3.5 w-3.5" /> Edit</> : <><Plus className="h-4 w-4" /> New article</>}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        title={article ? "Edit article" : "New article"}
        description="Published articles are searchable by agents and used to ground AI reply suggestions."
        footer={
          <>
            {article && (
              <Button variant="danger" className="mr-auto" disabled={pending} onClick={() => confirm("Delete this article?") && start(async () => { const r = await deleteArticleAction(brand, article.id); if (r.ok) { setOpen(false); router.push(`/cx/knowledge?brand=${brand}`); router.refresh(); } else setError(r.error); })}>
                Delete
              </Button>
            )}
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await saveArticleAction(brand, { title: a.title, body: a.body, category_id: a.category_id || null, status: a.status, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) }, article?.id);
                  if (!r.ok) return setError(r.error);
                  setOpen(false);
                  router.push(`/cx/knowledge?brand=${brand}&article=${r.data.id}`);
                  router.refresh();
                })
              }
            >
              Save article
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Callout tone="critical">{error}</Callout>}
          <Field label="Title" htmlFor="kb-title"><Input id="kb-title" value={a.title} onChange={(e) => setA({ ...a, title: e.target.value })} placeholder="e.g. How refunds work" /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Category" htmlFor="kb-cat">
              <Select id="kb-cat" value={a.category_id ?? ""} onChange={(e) => setA({ ...a, category_id: e.target.value || null })}>
                <option value="">Uncategorized</option>
                {catOptions(cats)}
              </Select>
            </Field>
            <Field label="Status" htmlFor="kb-status">
              <Select id="kb-status" value={a.status} onChange={(e) => setA({ ...a, status: e.target.value as Art["status"] })}>
                <option value="published">Published</option>
                <option value="draft">Draft (hidden from search and AI)</option>
              </Select>
            </Field>
            <Field label="Tags" htmlFor="kb-tags" hint="Comma-separated"><Input id="kb-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="refund, billing" /></Field>
          </div>
          <Field label="Article" htmlFor="kb-body" hint="Plain text. Blank lines separate paragraphs.">
            <Textarea id="kb-body" rows={14} value={a.body} onChange={(e) => setA({ ...a, body: e.target.value })} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

export function CategoryManager({ brand, cats }: { brand: string; cats: Cat[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Failed");
      else {
        setError(null);
        after?.();
        router.refresh();
      }
    });
  const top = cats.filter((c) => !c.parent_id);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><FolderTree className="h-3.5 w-3.5" /> Manage</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Categories" description="Two levels: categories and subcategories. Deleting a category removes its subcategories; articles become uncategorized." footer={<Button onClick={() => setOpen(false)}>Done</Button>}>
        <div className="space-y-3">
          {error && <Callout tone="critical">{error}</Callout>}
          <div className="flex flex-wrap gap-2">
            <Input aria-label="New category name" value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" className="min-w-0 flex-1" />
            <Select aria-label="Parent category" value={parent} onChange={(e) => setParent(e.target.value)} className="w-44">
              <option value="">Top level</option>
              {top.map((c) => <option key={c.id} value={c.id}>Under {c.name}</option>)}
            </Select>
            <Button variant="primary" disabled={!name.trim() || pending} onClick={() => run(() => saveCategoryAction(brand, { name, parent_id: parent || null }), () => setName(""))}><Plus className="h-4 w-4" /> Add</Button>
          </div>
          <div className="divide-y divide-border rounded-md border border-border">
            {cats.length === 0 && <p className="p-3 text-[13px] text-text-3">No categories yet.</p>}
            {top.flatMap((p) => [p, ...cats.filter((c) => c.parent_id === p.id)]).map((c) => (
              <div key={c.id} className="flex items-center gap-2 px-2.5 py-1.5">
                {c.parent_id && <span className="w-3 text-text-3">›</span>}
                <Input aria-label="Category name" value={editing[c.id] ?? c.name} onChange={(e) => setEditing({ ...editing, [c.id]: e.target.value })} className="h-8 min-w-0 flex-1" />
                <span className="w-16 text-right text-[12px] text-text-3">{c.articles} art.</span>
                {editing[c.id] != null && editing[c.id] !== c.name && <Button size="sm" onClick={() => run(() => saveCategoryAction(brand, { id: c.id, name: editing[c.id], parent_id: c.parent_id }))}>Save</Button>}
                <Button size="icon" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => confirm(`Delete ${c.name}?`) && run(() => deleteCategoryAction(brand, c.id))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        </div>
      </Dialog>
    </>
  );
}
