"use client";

import { ChevronDown, ChevronRight, Download, EyeOff, Lock, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { ClassificationNode, FieldDef, FieldInput } from "@/lib/cx/admin/fields";
import { classificationsToCsv, FIELD_TYPES, fieldsToCsv, OPTION_SEP } from "@/lib/cx/admin/pure/fields";
import { cn } from "@/lib/utils";
import { CheckRow, Field, FileButton, downloadText, useRun } from "../_admin/ui";
import {
  deleteClassificationAction, deleteFieldAction, importClassificationsAction, importFieldsAction, importOptionsAction,
  saveClassificationAction, saveFieldAction, setOptionsAction,
} from "./actions";

const SENT_TONE = { positive: "good", neutral: "neutral", negative: "critical" } as const;
type Sentiment = ClassificationNode["sentiment"];

/* ---------------- Classification ---------------- */

export function ClassificationPanel({ brand, nodes, usage }: { brand: string; nodes: ClassificationNode[]; usage: Record<string, number> }) {
  const { run, busy, messages } = useRun();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [edit, setEdit] = useState<{ id?: string; parentId: string | null; label: string; sentiment: Sentiment; hidden: boolean } | null>(null);
  const kids = (p: string | null) => nodes.filter((n) => n.parentId === p);
  const pathOf = (id: string | null): string[] => { const n = nodes.find((x) => x.id === id); return n ? [...pathOf(n.parentId), n.label] : []; };

  const row = (n: ClassificationNode) => {
    const children = kids(n.id);
    const expanded = open[n.id] ?? n.level === 1;
    return (
      <li key={n.id}>
        <div className={cn("group flex items-center gap-2 rounded-md py-1.5 pr-1 hover:bg-surface-3", n.hidden && "opacity-60")} style={{ paddingLeft: (n.level - 1) * 20 + 4 }}>
          <button type="button" className={cn("text-text-3", !children.length && "invisible")} onClick={() => setOpen({ ...open, [n.id]: !expanded })} aria-label={expanded ? "Collapse" : "Expand"}>
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <span className="min-w-0 flex-1 truncate text-[13px] text-text">{n.label}</span>
          {n.hidden && <EyeOff className="h-3.5 w-3.5 text-text-3" aria-label="Hidden from agents" />}
          {n.sentiment && <Badge tone={SENT_TONE[n.sentiment]}>{n.sentiment}</Badge>}
          <span className="w-14 text-right text-[12px] text-text-3 tabular" title="Tickets classified here">{usage[n.id] ?? 0}</span>
          <div className="flex gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
            {n.level < 3 && <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Add child" onClick={() => setEdit({ parentId: n.id, label: "", sentiment: null, hidden: false })}><Plus className="h-3.5 w-3.5" /></Button>}
            <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Edit" onClick={() => setEdit({ id: n.id, parentId: n.parentId, label: n.label, sentiment: n.sentiment, hidden: n.hidden })}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Delete" onClick={() => confirm(`Delete "${n.label}" and everything under it?`) && run("del", deleteClassificationAction(brand, n.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        {expanded && children.length > 0 && <ul>{children.map(row)}</ul>}
      </li>
    );
  };

  return (
    <Card>
      <CardHeader
        title="Classification tree"
        description="Three levels: parent → child → sub-child. Sentiment set on a level applies to tickets classified there. Hidden branches stay on old tickets but agents can't pick them."
      />
      <CardBody>
        <div className="mb-3 flex flex-wrap justify-end gap-2">
            <FileButton label={<><Upload className="h-3.5 w-3.5" />Import</>} onText={(t) => run("imp", importClassificationsAction(brand, t), (d) => `Imported ${d.rows} rows, ${d.created} new classifications.`)} />
            <Button size="sm" onClick={() => downloadText("classifications.csv", classificationsToCsv(nodes))} disabled={!nodes.length}><Download className="h-3.5 w-3.5" />Export</Button>
            <Button size="sm" variant="primary" onClick={() => setEdit({ parentId: null, label: "", sentiment: null, hidden: false })}><Plus className="h-3.5 w-3.5" />Add</Button>
        </div>
        {messages}
        {nodes.length ? <ul className="-mx-1">{kids(null).map(row)}</ul> : (
          <EmptyState title="No classifications yet" description="Add top-level categories, or import a sheet with columns Level 1, Level 2, Level 3, Sentiment, Hidden." />
        )}
      </CardBody>
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit classification" : "Add classification"} description={edit?.parentId ? `Under ${pathOf(edit.parentId).join(OPTION_SEP)}` : "Top level"}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy === "save"} onClick={async () => { if (edit && (await run("save", saveClassificationAction(brand, edit)))) setEdit(null); }}>Save</Button></>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Label"><Input autoFocus value={edit.label} maxLength={100} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
            <Field label="Sentiment" hint="Optional. Reports and automation use it.">
              <Select value={edit.sentiment ?? ""} onChange={(e) => setEdit({ ...edit, sentiment: (e.target.value || null) as Sentiment })}>
                <option value="">None</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option>
              </Select>
            </Field>
            <CheckRow checked={edit.hidden} onChange={(v) => setEdit({ ...edit, hidden: v })} label="Hide from agents" hint="Hiding a level hides everything under it." />
          </div>
        )}
      </Dialog>
    </Card>
  );
}

/* ---------------- Additional & Custom Info fields ---------------- */

const blankField = (): FieldInput => ({ label: "", scope: "ticket", group: "additional_info", type: "text", options: [], required: false, validation: null, encrypted: false, hidden: false });

export function FieldsPanel({ brand, defs }: { brand: string; defs: FieldDef[] }) {
  const { run, busy, messages } = useRun();
  const [edit, setEdit] = useState<FieldInput | null>(null);
  const [optionsText, setOptionsText] = useState("");
  const [master, setMaster] = useState<FieldDef | null>(null);
  const groups = [
    { key: "additional_info" as const, title: "Additional Info", description: "Structured fields agents fill on a ticket or contact: text, numbers, dates, picklists, with validation and optional encryption." },
    { key: "custom_info" as const, title: "Custom Info", description: "Hierarchical master lists (for example Region > City > Branch), imported from a sheet and picked level by level." },
  ];
  const openEdit = (f: FieldInput) => { setEdit(f); setOptionsText(f.options.join("\n")); };
  const save = async () => {
    if (!edit) return;
    const options = optionsText.split("\n").map((x) => x.trim()).filter(Boolean);
    if (await run("save", saveFieldAction(brand, { ...edit, options }))) setEdit(null);
  };
  const isList = edit && (edit.type === "select" || edit.type === "multiselect");

  return (
    <div className="space-y-4">
      {messages}
      <div className="flex flex-wrap justify-end gap-2">
        <FileButton label={<><Upload className="h-3.5 w-3.5" />Import fields</>} onText={(t) => run("imp", importFieldsAction(brand, t), (d) => `Saved ${d.saved} fields.${d.errors.length ? ` ${d.errors.length} rows skipped: ${d.errors.slice(0, 3).join("; ")}` : ""}`)} />
        <Button size="sm" onClick={() => downloadText("fields.csv", fieldsToCsv(defs))}><Download className="h-3.5 w-3.5" />Export</Button>
      </div>
      {groups.map((g) => {
        const list = defs.filter((d) => d.group === g.key);
        return (
          <Card key={g.key}>
            <CardHeader title={g.title} description={g.description} actions={<Button size="sm" variant="primary" onClick={() => openEdit({ ...blankField(), group: g.key, type: g.key === "custom_info" ? "select" : "text" })}><Plus className="h-3.5 w-3.5" />Add field</Button>} />
            <CardBody>
              {list.length ? (
                <ul className="divide-y divide-border">
                  {list.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-text">
                          {d.label}
                          {d.required && <Badge tone="warning">Required</Badge>}
                          {d.encrypted && <Badge tone="info"><Lock className="mr-0.5 inline h-3 w-3" />Encrypted</Badge>}
                          {d.hidden && <Badge>Hidden</Badge>}
                        </div>
                        <div className="text-[12px] text-text-3">
                          <code>{d.key}</code> · {d.scope} · {FIELD_TYPES.find((t) => t.value === d.type)?.label ?? d.type}
                          {d.options.length ? ` · ${d.options.length} options` : ""}
                          {d.validation?.regex ? ` · pattern ${d.validation.regex}` : ""}
                        </div>
                      </div>
                      {(d.type === "select" || d.type === "multiselect") && <Button size="sm" variant="ghost" onClick={() => setMaster(d)}>Options</Button>}
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Edit ${d.label}`} onClick={() => openEdit({ ...d })}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${d.label}`} onClick={() => confirm(`Delete the field "${d.label}"? Values stored on tickets are kept but no longer shown.`) && run("del", deleteFieldAction(brand, d.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </li>
                  ))}
                </ul>
              ) : <p className="py-4 text-center text-[13px] text-text-3">No {g.title} fields yet.</p>}
            </CardBody>
          </Card>
        );
      })}

      <Dialog size="lg" open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.label}` : "Add field"}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy === "save"} onClick={save}>Save</Button></>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Label" className="sm:col-span-2"><Input autoFocus value={edit.label} maxLength={80} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
            <Field label="Applies to">
              <Select value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value as FieldDef["scope"] })}><option value="ticket">Tickets</option><option value="contact">Contacts</option></Select>
            </Field>
            <Field label="Type">
              <Select value={edit.type} disabled={!!edit.id && edit.group === "custom_info"} onChange={(e) => setEdit({ ...edit, type: e.target.value as FieldDef["type"] })}>
                {FIELD_TYPES.filter((t) => edit.group !== "custom_info" || t.value === "select" || t.value === "multiselect").map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            {isList && (
              <Field label="Options" className="sm:col-span-2" hint={edit.group === "custom_info" ? `One per line. Use "${OPTION_SEP.trim()}" for levels, e.g. North > Pune > Baner.` : "One per line."}>
                <Textarea value={optionsText} onChange={(e) => setOptionsText(e.target.value)} className="min-h-28 font-mono text-[12px]" />
              </Field>
            )}
            {!isList && edit.type !== "checkbox" && edit.type !== "date" && (
              <>
                <Field label="Validation pattern" hint="Regular expression, optional." className="sm:col-span-2">
                  <Input value={edit.validation?.regex ?? ""} placeholder="^[A-Z]{3}-\d{4}$" className="font-mono" onChange={(e) => setEdit({ ...edit, validation: { ...edit.validation, regex: e.target.value || undefined } })} />
                </Field>
                <Field label="Min length"><Input type="number" min={0} value={edit.validation?.minLength ?? ""} onChange={(e) => setEdit({ ...edit, validation: { ...edit.validation, minLength: e.target.value === "" ? undefined : Number(e.target.value) } })} /></Field>
                <Field label="Max length"><Input type="number" min={0} value={edit.validation?.maxLength ?? ""} onChange={(e) => setEdit({ ...edit, validation: { ...edit.validation, maxLength: e.target.value === "" ? undefined : Number(e.target.value) } })} /></Field>
              </>
            )}
            <div className="space-y-2 sm:col-span-2">
              <CheckRow checked={edit.required} onChange={(v) => setEdit({ ...edit, required: v })} label="Required before closing a ticket" />
              <CheckRow checked={edit.encrypted} onChange={(v) => setEdit({ ...edit, encrypted: v })} label="Encrypt stored values" hint="Values are shown masked; revealing one is written to the audit log." />
              <CheckRow checked={edit.hidden} onChange={(v) => setEdit({ ...edit, hidden: v })} label="Hide from agents" />
            </div>
          </div>
        )}
      </Dialog>
      <OptionsDialog brand={brand} field={master} onClose={() => setMaster(null)} />
    </div>
  );
}

function OptionsDialog({ brand, field, onClose }: { brand: string; field: FieldDef | null; onClose: () => void }) {
  const { run, busy, messages } = useRun();
  const [text, setText] = useState<string | null>(null);
  const value = text ?? field?.options.join("\n") ?? "";
  const close = () => { setText(null); onClose(); };
  return (
    <Dialog size="lg" open={!!field} onClose={close} title={field ? `${field.label} options` : ""} description="Edit the list, or import a sheet: each row's cells become one path (Region, City, Branch → Region > City > Branch)."
      footer={field && <>
        <FileButton className="mr-auto" label={<><Upload className="h-3.5 w-3.5" />Append from sheet</>} onText={(t) => run("imp", importOptionsAction(brand, field.id, t, "append"), (n) => { setText(null); return `${n} options now.`; })} />
        <Button onClick={close}>Close</Button>
        <Button variant="primary" loading={busy === "save"} onClick={() => run("save", setOptionsAction(brand, field.id, value.split("\n")), (n) => { setText(null); return `Saved ${n} options.`; })}>Save list</Button>
      </>}>
      {messages}
      <Textarea value={value} onChange={(e) => setText(e.target.value)} className="min-h-64 font-mono text-[12px]" />
    </Dialog>
  );
}

/* ---------------- System picklists ---------------- */

export function PicklistsPanel({ brand, defs }: { brand: string; defs: FieldDef[] }) {
  const { run, busy, messages } = useRun();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const sorted = useMemo(() => [...defs].sort((a, b) => a.order - b.order), [defs]);
  return (
    <Card>
      <CardHeader title="System picklists" description="Built-in ticket attributes. Severity is separate from priority. Leave a list empty to hide it from agents." />
      <CardBody>
        {messages}
        <div className="grid gap-4 md:grid-cols-2">
          {sorted.map((d) => {
            const v = drafts[d.id] ?? d.options.join("\n");
            return (
              <div key={d.id} className="rounded-md border border-border p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[13px] font-medium text-text">{d.label}</span>
                  <Badge>{d.options.length} values</Badge>
                </div>
                <Textarea aria-label={`${d.label} values`} value={v} onChange={(e) => setDrafts({ ...drafts, [d.id]: e.target.value })} className="min-h-28 text-[12.5px]" placeholder="One value per line" />
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="primary" disabled={drafts[d.id] == null} loading={busy === d.id} onClick={() => run(d.id, setOptionsAction(brand, d.id, v.split("\n")), () => { setDrafts((x) => { const n = { ...x }; delete n[d.id]; return n; }); return `${d.label} saved.`; })}>Save</Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
