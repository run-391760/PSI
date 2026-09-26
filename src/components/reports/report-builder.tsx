"use client";

import { BarChart3, Check, FolderKanban, Globe, Link2, Swords } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createReportAction, updateReportAction } from "@/app/(app)/reports/actions";
import { DATABASES, database, tryRootDomain } from "@/lib/domain";
import { dateLabel } from "@/lib/format";
import { ACCENTS, type AccentId, defaultSections, type ReportRecord, TEMPLATES, type TemplateId, templateById } from "@/lib/reports/templates";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";

type ProjectOption = { id: string; name: string; domain: string; country: string; competitors: string[] };
const ICONS: Record<TemplateId, typeof Globe> = { domain: Globe, project: FolderKanban, backlinks: Link2, comparison: Swords };

const lines = (v: string) =>
  v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

function Step({ n, title, description, children }: { n: number; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white">{n}</span>
            {title}
          </span>
        }
        description={description}
      />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/** My Reports builder: template → subject → sections → branding, with a live cover preview. */
export function ReportBuilder({
  projects,
  initial,
  defaults,
}: {
  projects: ProjectOption[];
  initial?: ReportRecord | null;
  defaults?: { template?: string; project?: string; domain?: string; db?: string };
}) {
  const router = useRouter();
  const startTemplate = templateById(initial?.template ?? defaults?.template) ?? TEMPLATES[0];
  const startProject = projects.find((p) => p.id === (initial?.project_id ?? defaults?.project)) ?? (startTemplate.subject === "project" ? projects[0] : undefined);
  const [templateId, setTemplateId] = useState<TemplateId>(startTemplate.id);
  const [projectId, setProjectId] = useState<string>(startProject?.id ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? defaults?.domain ?? startProject?.domain ?? "");
  const [db, setDb] = useState(initial?.db ?? defaults?.db ?? startProject?.country ?? "US");
  const [competitors, setCompetitors] = useState((initial?.options.competitors ?? startProject?.competitors.slice(0, 4) ?? []).join("\n"));
  const [sections, setSections] = useState<string[]>(initial?.sections ?? defaultSections(startTemplate));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(!!initial);
  const [company, setCompany] = useState(initial?.branding.company ?? "");
  const [preparedFor, setPreparedFor] = useState(initial?.branding.preparedFor ?? "");
  const [accent, setAccent] = useState<AccentId>((initial?.branding.accent as AccentId) ?? "indigo");
  const [intro, setIntro] = useState(initial?.branding.intro ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const template = templateById(templateId)!;
  const project = projects.find((p) => p.id === projectId);
  const effectiveSubject = template.subject === "project" ? (project?.domain ?? "") : subject.trim();
  const autoTitle = `${template.short} report${effectiveSubject ? `: ${tryRootDomain(effectiveSubject) ?? effectiveSubject}` : ""}`;
  const shownTitle = titleTouched ? title : autoTitle;
  const accentHex = ACCENTS.find((a) => a.id === accent)?.color ?? ACCENTS[0].color;
  const compList = lines(competitors);
  const domainError = template.subject === "domain" && subject.trim() && !tryRootDomain(subject) ? "Enter a valid domain, e.g. example.com" : null;
  const orderedSections = useMemo(() => template.sections.filter((s) => sections.includes(s.id)), [template, sections]);

  const chooseTemplate = (id: TemplateId) => {
    const t = templateById(id)!;
    setTemplateId(id);
    setSections(defaultSections(t));
    if (t.subject === "project" && !projectId && projects[0]) chooseProject(projects[0].id);
    setError(null);
  };
  const chooseProject = (id: string) => {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    if (p) {
      setSubject(p.domain);
      setDb(p.country);
      setCompetitors(p.competitors.slice(0, 4).join("\n"));
    }
  };
  const toggle = (id: string) => setSections((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const save = () => {
    setError(null);
    if (template.subject === "project" && !projectId) return setError("Choose a project for this report.");
    if (template.subject === "domain" && !tryRootDomain(subject)) return setError("Enter a valid domain for this report.");
    if (template.competitors && !compList.length) return setError("Add at least one competitor to compare with.");
    if (compList.length > 4 && template.competitors) return setError("Compare with at most 4 competitors.");
    if (!sections.length) return setError("Choose at least one section.");
    const input = {
      template: templateId,
      title: shownTitle.trim() || autoTitle,
      subject: template.subject === "project" ? "" : subject.trim(),
      db: db as never,
      project_id: projectId || null,
      competitors: template.competitors ? compList : [],
      sections: orderedSections.map((s) => s.id),
      branding: { company, preparedFor, accent, intro },
    };
    start(async () => {
      const res = initial ? await updateReportAction(initial.id, input) : await createReportAction(input);
      if (!res.ok) return setError(res.error);
      router.push(`/reports/${res.data.id}`);
      router.refresh();
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <Step n={1} title="Template" description="What kind of report do you need?">
          <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Report template">
            {TEMPLATES.map((t) => {
              const Icon = ICONS[t.id];
              const on = t.id === templateId;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => chooseTemplate(t.id)}
                  className={cn("relative flex gap-3 rounded-lg border p-3 text-left transition-colors", on ? "border-brand bg-brand-soft/60 ring-1 ring-brand" : "border-border hover:border-border-strong hover:bg-surface-2")}
                >
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", on ? "bg-brand text-white" : "bg-surface-3 text-text-2")}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-text">{t.name}</span>
                    <span className="mt-0.5 block text-[12px] text-text-3">{t.description}</span>
                  </span>
                  {on && <Check className="absolute top-2.5 right-2.5 h-4 w-4 text-brand-ink" />}
                </button>
              );
            })}
          </div>
        </Step>

        <Step n={2} title={template.subject === "project" ? "Project" : "Domain"} description={template.subject === "project" ? "The project whose tools and metrics the report covers." : "Analyze any domain, or start from one of your projects."}>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={template.subject === "project" ? "Project" : "Start from a project (optional)"} htmlFor="r-project">
              <Select id="r-project" value={projectId} onChange={(e) => (e.target.value ? chooseProject(e.target.value) : setProjectId(""))} disabled={template.subject === "project" && !projects.length}>
                {template.subject !== "project" && <option value="">— Any domain —</option>}
                {template.subject === "project" && !projects.length && <option value="">No projects yet</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.domain})
                  </option>
                ))}
              </Select>
            </Field>
            {template.subject === "domain" ? (
              <Field label="Domain" htmlFor="r-domain" error={domainError}>
                <Input id="r-domain" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="example.com" />
              </Field>
            ) : (
              <Field label="Domain" htmlFor="r-pdomain" hint="Market and device come from the project settings.">
                <Input id="r-pdomain" value={project ? `${project.domain} · ${database(project.country).flag} ${project.country}` : ""} disabled readOnly />
              </Field>
            )}
            {template.subject === "domain" && (
              <Field label="Regional database" htmlFor="r-db">
                <Select id="r-db" value={db} onChange={(e) => setDb(e.target.value)}>
                  {DATABASES.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.flag} {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          {template.subject === "project" && !projects.length && (
            <Callout tone="warning" className="mt-3">
              You need a project for this template. <Link href="/projects" className="text-link hover:underline">Create a project</Link> first, or choose a domain-based template.
            </Callout>
          )}
          {template.competitors && (
            <Field label={`Competitors (${compList.length}/4)`} htmlFor="r-comp" hint="Up to 4 domains, one per line." error={compList.length > 4 ? "Remove some competitors (maximum 4)." : undefined} className="mt-3.5">
              <Textarea id="r-comp" value={competitors} onChange={(e) => setCompetitors(e.target.value)} rows={4} placeholder={"competitor1.com\ncompetitor2.com"} />
            </Field>
          )}
        </Step>

        <Step n={3} title="Sections" description={`${sections.length} of ${template.sections.length} sections selected`}>
          <div className="mb-2 flex gap-3 text-[12.5px]">
            <button type="button" className="text-link hover:underline" onClick={() => setSections(template.sections.map((s) => s.id))}>
              Select all
            </button>
            <button type="button" className="text-link hover:underline" onClick={() => setSections(defaultSections(template))}>
              Recommended
            </button>
            <button type="button" className="text-link hover:underline" onClick={() => setSections([])}>
              Clear
            </button>
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {template.sections.map((s) => (
              <li key={s.id}>
                <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2", sections.includes(s.id) ? "border-brand/40 bg-brand-soft/40" : "border-border hover:bg-surface-2")}>
                  <Checkbox checked={sections.includes(s.id)} onChange={() => toggle(s.id)} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-text">{s.label}</span>
                    <span className="block text-[12px] text-text-3">{s.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Step>

        <Step n={4} title="Branding" description="Shown on the cover and in the header of every section.">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Report title" htmlFor="r-title" className="sm:col-span-2">
              <Input
                id="r-title"
                value={shownTitle}
                maxLength={140}
                onChange={(e) => {
                  setTitleTouched(true);
                  setTitle(e.target.value);
                }}
              />
            </Field>
            <Field label="Company name" htmlFor="r-company" hint="Your agency or company.">
              <Input id="r-company" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={80} placeholder="Acme Digital" />
            </Field>
            <Field label="Prepared for" htmlFor="r-for" hint="Client name (optional).">
              <Input id="r-for" value={preparedFor} onChange={(e) => setPreparedFor(e.target.value)} maxLength={80} placeholder="Client Inc." />
            </Field>
            <div className="sm:col-span-2">
              <span className="mb-1 block text-[12.5px] font-medium text-text-2">Accent color</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent color">
                {ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={a.id === accent}
                    aria-label={a.label}
                    title={a.label}
                    onClick={() => setAccent(a.id)}
                    className={cn("flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition", a.id === accent ? "ring-2 ring-text" : "hover:scale-105")}
                    style={{ background: a.color }}
                  >
                    {a.id === accent && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Introduction (optional)" htmlFor="r-intro" hint="An executive summary printed under the cover." className="sm:col-span-2">
              <Textarea id="r-intro" value={intro} onChange={(e) => setIntro(e.target.value)} maxLength={1500} rows={3} placeholder="This report summarizes…" />
            </Field>
          </div>
        </Step>
      </div>

      <aside className="lg:sticky lg:top-18 lg:self-start">
        <Card className="overflow-hidden">
          <div className="px-4 pt-3.5 pb-2 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Preview</div>
          <div className="mx-4 overflow-hidden rounded-md border border-border bg-surface">
            <div className="h-1.5" style={{ background: accentHex }} />
            <div className="p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-text-2 uppercase">
                <span className="flex h-4 w-4 items-center justify-center rounded text-white" style={{ background: accentHex }}>
                  <BarChart3 className="h-2.5 w-2.5" />
                </span>
                {company || "SynapseSEO"}
              </div>
              <div className="mt-2 text-[15px] leading-snug font-semibold text-text">{shownTitle || autoTitle}</div>
              <div className="mt-0.5 text-[12px] text-text-2">
                {effectiveSubject || "—"}
                {template.competitors && compList.length > 0 && ` vs ${compList.slice(0, 4).join(", ")}`}
              </div>
              <div className="mt-2 text-[11px] text-text-3">
                {preparedFor && <>Prepared for {preparedFor} · </>}
                {dateLabel(new Date())}
              </div>
            </div>
          </div>
          <ol className="mt-3 space-y-1 px-4 text-[12.5px]">
            {orderedSections.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2 text-text-2">
                <span className="tabular w-4 text-right text-text-3">{i + 1}.</span>
                {s.label}
              </li>
            ))}
            {!orderedSections.length && <li className="text-text-3">No sections selected</li>}
          </ol>
          <div className="mt-4 space-y-2 border-t border-border p-4">
            {error && <Callout tone="critical">{error}</Callout>}
            <Button variant="primary" className="w-full" onClick={save} loading={pending}>
              {initial ? "Save changes" : "Create report"}
            </Button>
            <Link href={initial ? `/reports/${initial.id}` : "/reports"} className="block text-center text-[12.5px] text-text-2 hover:text-text">
              Cancel
            </Link>
          </div>
        </Card>
      </aside>
    </div>
  );
}
