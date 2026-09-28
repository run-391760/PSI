"use client";

import { Check, Crop, ExternalLink, FileText, ImagePlus, MessageSquare, Send, Sparkles, Trash2, X as XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { commentAction, deletePublishedAction, markManualAction, savePostAction, suggestCaptionsAction, transitionAction } from "@/app/(app)/cx/publishing/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { PUB_CHANNELS, buildUtmUrl, channelProblems, countChars, pubChannel, renderText, type ChannelResult, type PostStatus, type Utm } from "@/lib/cx/publishing/core";
import { canDecide, manualSteps, POST_TYPES, typeProblems, typeSupport, type PostOptions } from "@/lib/cx/publishing/options";
import type { HashtagSuggestion } from "@/lib/cx/publishing/suggest";
import { cn } from "@/lib/utils";
import { AiCompose } from "./ai-compose";
import { ImageEditor } from "./image-editor";
import { LocalTime } from "./posts-table";
import { ChannelChip, StatusBadge } from "./shared";
import { ApprovalProgress, ApproverPicker, BestTimes, HashtagChips, NetworkOptions, TagPicker, type DecisionItem } from "./wp4-fields";

export type ComposerPost = {
  id: string;
  status: PostStatus;
  title: string;
  body: string;
  variants: Record<string, string>;
  channels: string[];
  media: string[];
  first_comment: string;
  link_url: string | null;
  utm: Utm;
  links: Record<string, string>;
  campaign_id: string | null;
  approver_id: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  results: Record<string, ChannelResult>;
  author: string | null;
  post_type: string;
  options: PostOptions;
  approver_ids: string[];
  content_tags: string[];
};
export type ComposerProps = {
  brandId: string;
  brandName: string;
  domain: string;
  origin: string;
  post: ComposerPost | null;
  channels: { kind: string; connected: boolean; reason: string | null; publishApi: boolean }[];
  assets: { id: string; filename: string; mime: string; tags: string[]; approval: string }[];
  campaigns: { id: string; name: string }[];
  approvers: { user_id: string; name: string }[];
  ai: boolean;
  canAuthor: boolean;
  canApprove: boolean;
  requireApproval: boolean;
  comments: { id: string; author_name: string; kind: string; body: string; created_at: string }[];
  initialDate: string | null;
  userId: string;
  decisions: DecisionItem[];
  requireAssetApproval: boolean;
  tags: { defined: string[]; canCreate: boolean; locked: boolean };
  bestTime: { clicks: Record<string, number[]>; mentions: number[] };
  hashtags: HashtagSuggestion[];
  imageAi: boolean;
  deletable: string[];
};

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const assetUrl = (id: string) => `/api/cx/publishing/assets/${id}`;
const KIND_LABEL: Record<string, string> = {
  created: "created the post",
  submit: "submitted for approval",
  approve: "approved",
  approve_partial: "approved",
  reject: "requested changes",
  schedule: "scheduled",
  publish: "published",
  failed: "could not publish",
  deleted: "deleted a published post",
  notice: "notified the team",
  comment: "commented",
};
const KIND_TONE: Record<string, string> = { publish: "bg-good", failed: "bg-critical", reject: "bg-critical", approve: "bg-good", approve_partial: "bg-good", deleted: "bg-warning", submit: "bg-brand", schedule: "bg-brand" };
const kindOf = (mime: string) => (mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : "document") as "image" | "video" | "document";

export function Composer(props: ComposerProps) {
  const { brandId, post } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState(post?.title ?? "");
  const [body, setBody] = useState(post?.body ?? "");
  const [variants, setVariants] = useState<Record<string, string>>(post?.variants ?? {});
  const [channels, setChannels] = useState<string[]>(post?.channels ?? props.channels.filter((c) => c.connected).map((c) => c.kind));
  const [media, setMedia] = useState<string[]>(post?.media ?? []);
  const [firstComment, setFirstComment] = useState(post?.first_comment ?? "");
  const [linkUrl, setLinkUrl] = useState(post?.link_url ?? "");
  const [utm, setUtm] = useState<Utm>({ medium: "social", ...(post?.utm ?? {}) });
  const [campaignId, setCampaignId] = useState(post?.campaign_id ?? "");
  const [approverIds, setApproverIds] = useState<string[]>(post?.approver_ids ?? []);
  const [postType, setPostType] = useState<string>(post?.post_type ?? "text");
  const [options, setOptions] = useState<PostOptions>(post?.options ?? {});
  const [contentTags, setContentTags] = useState<string[]>(post?.content_tags ?? []);
  const [editing, setEditing] = useState<{ id: string; filename: string; mime: string } | null>(null);
  const [when, setWhen] = useState("");
  const [tab, setTab] = useState<string>("base");
  const [preview, setPreview] = useState<string>(post?.channels[0] ?? "facebook");
  const [pickOpen, setPickOpen] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    // Local time zone is only known in the browser.
    setWhen(post?.scheduled_at ? toLocalInput(post.scheduled_at) : props.initialDate ? `${props.initialDate}T09:00` : "");
  }, [post?.scheduled_at, props.initialDate]);

  const status = post?.status ?? "draft";
  const editable = props.canAuthor && status !== "published";
  const sampleShort = (k: string) => (linkUrl.trim() ? `${props.origin}/l/${post?.links[k] ?? "xxxxxxx"}` : null);
  const textFor = (k: string) => renderText(body, variants, k, sampleShort);
  const mediaCount = media.length;
  const mediaKinds = media.map((id) => ({ kind: kindOf(props.assets.find((a) => a.id === id)?.mime ?? "image/") }));
  const problems = useMemo(
    () => Object.fromEntries(channels.map((k) => [k, [...channelProblems(textFor(k), k, mediaCount).filter((x) => !(postType !== "text" && /needs an image/.test(x) && mediaCount)), ...typeProblems(postType, k, options, mediaKinds)]])),
    [channels, body, variants, mediaCount, linkUrl, postType, options, media], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const manual = manualSteps(postType, channels, options);
  const hasProblems = Object.values(problems).some((p) => p.length);
  const utmPreview = useMemo(() => {
    if (!linkUrl.trim()) return null;
    try {
      return buildUtmUrl(linkUrl, { ...utm, source: channels[0] ?? "social" });
    } catch (e) {
      return e instanceof Error ? `⚠ ${e.message}` : null;
    }
  }, [linkUrl, utm, channels]);

  const input = () => ({
    id: post?.id,
    title,
    body,
    variants,
    channels,
    media,
    firstComment,
    linkUrl,
    utm,
    campaignId: campaignId || null,
    approverId: post?.approver_id ?? null,
    scheduledAt: when ? new Date(when).toISOString() : null,
    postType,
    options,
    approverIds,
    contentTags,
  });

  const save = (then?: (id: string) => Promise<{ ok: boolean; error?: string }>, message?: string) =>
    start(async () => {
      setNotice(null);
      const r = await savePostAction(brandId, input());
      if (!r.ok) return setError(r.error);
      if (then) {
        const t = await then(r.data);
        if (!t.ok) {
          setError(t.error ?? "Failed.");
          if (!post) router.replace(`/cx/publishing/${r.data}?brand=${brandId}`);
          return;
        }
      }
      setError(null);
      setNotice(message ?? "Draft saved.");
      if (!post) router.replace(`/cx/publishing/${r.data}?brand=${brandId}`);
      else router.refresh();
    });
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, message: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Failed.");
      setError(null);
      setNotice(message);
      setNote("");
      router.refresh();
    });

  const toggle = (k: string) => setChannels((cs) => (cs.includes(k) ? cs.filter((c) => c !== k) : [...cs, k]));
  const canSchedule = !props.requireApproval || ["approved", "scheduled", "failed"].includes(status);
  const activeText = tab === "base" ? body : (variants[tab] ?? "");
  const setActive = (t: string) => (tab === "base" ? setBody(t) : setVariants({ ...variants, [tab]: t }));
  const iDecide = post ? canDecide(props.userId, post.approver_ids, props.canApprove) : false;
  const myDecision = props.decisions.find((d) => d.user_id === props.userId)?.decision;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid min-w-0 content-start gap-5">
        {error && <Callout tone="critical">{error}</Callout>}
        {notice && <Callout tone="good">{notice}</Callout>}
        {post && status === "pending" && post.approver_ids.length > 0 && (!iDecide || myDecision === "approved") && (
          <Card>
            <CardHeader title="Waiting for approval" description={`All ${post.approver_ids.length} designated approvers must approve.`} />
            <CardBody>
              <ApprovalProgress approvers={props.approvers} designated={post.approver_ids} decisions={props.decisions} />
            </CardBody>
          </Card>
        )}
        {post && status === "pending" && iDecide && myDecision !== "approved" && (
          <Card className="border-warning/40">
            <CardHeader title="Waiting for your approval" description={post.approver_ids.length > 1 ? `Every designated approver must approve (${props.decisions.filter((d) => d.decision === "approved" && post.approver_ids.includes(d.user_id)).length} of ${post.approver_ids.length} so far).` : "Approve, or request changes with a comment for the author."} />
            <CardBody className="grid gap-2">
              <ApprovalProgress approvers={props.approvers} designated={post.approver_ids} decisions={props.decisions} />
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Comment (required to request changes)" />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={pending} onClick={() => act(() => transitionAction(brandId, post.id, "approve", note), post.scheduled_at ? "Approved and scheduled." : "Approved.")}>
                  <Check className="h-4 w-4" /> Approve
                </Button>
                <Button disabled={pending || !note.trim()} onClick={() => act(() => transitionAction(brandId, post.id, "reject", note), "Changes requested; the post is back in draft.")}>
                  Request changes
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Post type & channels" description="Pick the format, then where it goes. Unconnected channels can still be planned and scheduled." />
          <CardBody className="grid gap-3">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Post type">
              {POST_TYPES.map((t) => (
                <button
                  key={t.type}
                  type="button"
                  role="radio"
                  aria-checked={postType === t.type}
                  disabled={!editable}
                  title={t.hint}
                  onClick={() => setPostType(t.type)}
                  className={cn("rounded-full border px-2.5 py-1 text-[12.5px]", postType === t.type ? "border-brand bg-brand-soft text-text" : "border-border text-text-2 hover:bg-surface-3")}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
            {PUB_CHANNELS.map((c) => {
              const st = props.channels.find((x) => x.kind === c.kind);
              const on = channels.includes(c.kind);
              const support = typeSupport(postType, c.kind);
              return (
                <button
                  key={c.kind}
                  type="button"
                  disabled={!editable || (support === "none" && !on)}
                  onClick={() => toggle(c.kind)}
                  title={support === "none" ? `Does not support this post type` : st?.connected ? "Connected" : (st?.reason ?? c.note ?? "")}
                  className={cn("flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13px] transition-colors disabled:opacity-50", on ? "border-brand bg-brand-soft text-text" : "border-border-strong text-text-2 hover:bg-surface-3")}
                >
                  <ChannelChip kind={c.kind} />
                  {c.name}
                  {support === "manual" && <span className="text-[11px] text-text-3">manual</span>}
                  <span className={cn("h-1.5 w-1.5 rounded-full", st?.connected ? "bg-good" : "bg-border-strong")} />
                </button>
              );
            })}
            </div>
          </CardBody>
          {channels.some((k) => !props.channels.find((x) => x.kind === k)?.connected) && (
            <p className="px-4 pb-3 text-[12px] text-text-3">
              Not connected: {channels.filter((k) => !props.channels.find((x) => x.kind === k)?.connected).map((k) => pubChannel(k)?.name).join(", ")} — these will be marked “channel not connected” when due (see{" "}
              <Link href={`/cx/publishing?brand=${brandId}&tab=settings`} className="text-link hover:underline">Channels & roles</Link>).
            </p>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Content"
            description="Write once, then customize per channel. Use {link} where the tracked short link should go."
            actions={
              props.ai || props.imageAi ? (
                <div className="flex flex-wrap gap-1.5">
                  <AiCompose
                    brandId={brandId}
                    channel={tab === "base" ? (channels[0] ?? "facebook") : tab}
                    postType={postType}
                    textAi={props.ai}
                    imageAi={props.imageAi}
                    disabled={!editable}
                    onText={(t, poll) => {
                      setActive(t);
                      if (poll.length >= 2) setOptions({ ...options, common: { ...(options.common ?? {}), poll_options: poll } });
                    }}
                    onImage={(id) => {
                      setMedia([...media, id]);
                      router.refresh();
                    }}
                  />
                  {props.ai && <AiSuggest brandId={brandId} text={activeText || body} channel={tab === "base" ? (channels[0] ?? "facebook") : tab} onUse={setActive} disabled={!editable} />}
                </div>
              ) : null
            }
          />
          <CardBody className="grid gap-3">
            <Field label="Internal title (optional)" htmlFor="pc-title">
              <Input id="pc-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editable} placeholder="e.g. Autumn guide launch" />
            </Field>
            <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-border">
              {["base", ...channels].map((k) => (
                <button key={k} type="button" onClick={() => setTab(k)} className={cn("-mb-px border-b-2 px-3 py-2 text-[13px] whitespace-nowrap", tab === k ? "border-brand font-medium text-text" : "border-transparent text-text-2")}>
                  {k === "base" ? "All channels" : pubChannel(k)?.name}
                  {k !== "base" && variants[k]?.trim() && <span className="ml-1 text-[11px] text-text-3">custom</span>}
                </button>
              ))}
            </div>
            <Textarea
              rows={7}
              value={activeText}
              disabled={!editable}
              onChange={(e) => (tab === "base" ? setBody(e.target.value) : setVariants({ ...variants, [tab]: e.target.value }))}
              placeholder={tab === "base" ? "What do you want to share?" : `Leave empty to use the text for all channels. Customize for ${pubChannel(tab)?.name}…`}
            />
            {(!props.ai || !props.imageAi) && (
              <p className="text-[12px] text-text-3">
                {!props.ai ? "AI captions and prompt-based writing: connect an AI key (ANTHROPIC_API_KEY or OPENAI_API_KEY) on the server. " : ""}
                {!props.imageAi ? "AI image generation: set OPENAI_API_KEY (image API) on the server." : ""}
              </p>
            )}
            <HashtagChips items={props.hashtags} draft={activeText + " " + firstComment} disabled={!editable} onAdd={(t) => setActive(`${activeText.replace(/\s+$/, "")}${activeText.trim() ? " " : ""}#${t}`)} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
              {channels.map((k) => {
                const n = countChars(textFor(k), k);
                const lim = pubChannel(k)!.limit;
                return (
                  <span key={k} className={cn(n > lim ? "font-medium text-critical-ink" : "text-text-2")}>
                    {pubChannel(k)?.name}: {n.toLocaleString("en-US")}/{lim.toLocaleString("en-US")}
                  </span>
                );
              })}
            </div>
            {tab !== "base" && pubChannel(tab)?.note && <p className="text-[12px] text-text-3">{pubChannel(tab)!.note}</p>}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[13px] font-medium">Media</span>
                {editable && (
                  <Button size="sm" onClick={() => setPickOpen(true)}>
                    <ImagePlus className="h-3.5 w-3.5" /> From library
                  </Button>
                )}
              </div>
              {media.length ? (
                <div className="flex flex-wrap gap-2">
                  {media.map((id) => {
                    const a = props.assets.find((x) => x.id === id);
                    const k = kindOf(a?.mime ?? "image/");
                    return (
                      <div key={id} className="relative h-20 w-20 overflow-hidden rounded-md border border-border bg-surface-2" title={a?.filename}>
                        {k === "video" ? <video src={assetUrl(id)} className="h-full w-full object-cover" muted /> : k === "document" ? <DocTile name={a?.filename ?? "Document"} /> : <img src={assetUrl(id)} alt={a?.filename ?? ""} className="h-full w-full object-cover" />}
                        {editable && (
                          <button type="button" onClick={() => setMedia(media.filter((m) => m !== id))} className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white" aria-label="Remove">
                            <XIcon className="h-3 w-3" />
                          </button>
                        )}
                        {editable && k === "image" && a && a.mime !== "image/gif" && (
                          <button type="button" onClick={() => setEditing(a)} className="absolute bottom-1 left-1 rounded-full bg-black/60 p-1 text-white" aria-label="Edit or crop" title="Edit / crop">
                            <Crop className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[12.5px] text-text-3">No media. Instagram requires an image or video.</p>
              )}
            </div>

            {channels.some((k) => pubChannel(k)?.firstComment) && (
              <Field label="First comment" htmlFor="pc-fc" hint="Posted right after publishing on Facebook, Instagram and LinkedIn, and as a reply on X.">
                <Textarea id="pc-fc" rows={2} value={firstComment} onChange={(e) => setFirstComment(e.target.value)} disabled={!editable} placeholder="Hashtags or a link, posted as the first comment" />
              </Field>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Network options" description="Per-network settings. Options marked manual are not in the network's API; they are kept as a checklist." />
          <CardBody className="grid gap-3">
            <NetworkOptions channels={channels} postType={postType} options={options} onChange={setOptions} disabled={!editable} assets={props.assets} />
            {manual.length > 0 && (
              <Callout tone="info" title="Manual steps">
                <ul className="list-disc pl-4">{manual.map((m) => <li key={m}>{m}</li>)}</ul>
              </Callout>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Link & UTM tracking" description="One short link per channel (utm_source = channel) replaces {link}; clicks are tracked in Social analytics." />
          <CardBody className="grid gap-3">
            <Field label="Destination URL" htmlFor="pc-link">
              <Input id="pc-link" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} disabled={!editable} placeholder={`https://${props.domain}/…`} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-4">
              {(["medium", "campaign", "term", "content"] as const).map((k) => (
                <Field key={k} label={`utm_${k}`} htmlFor={`pc-utm-${k}`}>
                  <Input id={`pc-utm-${k}`} value={utm[k] ?? ""} onChange={(e) => setUtm({ ...utm, [k]: e.target.value })} disabled={!editable} placeholder={k === "campaign" ? "from campaign" : ""} />
                </Field>
              ))}
            </div>
            {utmPreview && <p className="rounded-md bg-surface-2 px-3 py-2 font-mono text-[12px] break-all text-text-2">{utmPreview}</p>}
            {linkUrl.trim() && !body.includes("{link}") && !Object.values(variants).some((v) => v.includes("{link}")) && (
              <p className="text-[12px] text-warning-ink">Add {"{link}"} to the text where the short link should appear.</p>
            )}
            {post && Object.keys(post.links).length > 0 && (
              <ul className="grid gap-1 text-[12.5px]">
                {Object.entries(post.links).map(([k, code]) => (
                  <li key={k} className="flex items-center gap-2">
                    <ChannelChip kind={k} /> <span className="font-mono">{props.origin}/l/{code}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Plan & schedule" />
          <CardBody className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Campaign" htmlFor="pc-camp">
                <Select id="pc-camp" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={!editable}>
                  <option value="">None</option>
                  {props.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Publish at (your time)" htmlFor="pc-when">
                <Input id="pc-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={!editable} />
              </Field>
            </div>
            <BestTimes data={props.bestTime} channels={channels} onPick={setWhen} disabled={!editable} />
            <div className="grid gap-4 sm:grid-cols-2">
              <ApproverPicker approvers={props.approvers} value={approverIds} onChange={setApproverIds} disabled={!editable} />
              <TagPicker defined={props.tags.defined} value={contentTags} onChange={setContentTags} disabled={!editable} canCreate={props.tags.canCreate} locked={props.tags.locked} />
            </div>
          </CardBody>
          {editable && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
              <Button disabled={pending || !channels.length} onClick={() => save()}>
                Save draft
              </Button>
              {["draft", "failed"].includes(status) && (
                <Button disabled={pending || !channels.length || hasProblems} onClick={() => save((id) => transitionAction(brandId, id, "submit", ""), "Submitted for approval.")}>
                  <Send className="h-4 w-4" /> Submit for approval
                </Button>
              )}
              {(canSchedule || (!props.requireApproval && status === "draft")) && (
                <>
                  <Button variant="primary" disabled={pending || !channels.length || hasProblems || !when} title={!when ? "Pick a date and time" : undefined} onClick={() => save((id) => transitionAction(brandId, id, "schedule", "", new Date(when).toISOString()), "Scheduled.")}>
                    Schedule
                  </Button>
                  <Button disabled={pending || !channels.length || hasProblems} onClick={() => confirm("Publish to the selected channels now?") && save((id) => transitionAction(brandId, id, "publish_now", ""), "Publishing now — results appear in a minute.")}>
                    Publish now
                  </Button>
                </>
              )}
              {post && status === "scheduled" && (
                <Button variant="ghost" disabled={pending} onClick={() => act(() => transitionAction(brandId, post.id, "unschedule"), "Unscheduled.")}>
                  Unschedule
                </Button>
              )}
              {props.requireApproval && !canSchedule && <span className="text-[12px] text-text-3">Approval is required before scheduling.</span>}
              {hasProblems && <span className="text-[12px] text-critical-ink">Fix the issues in the preview first.</span>}
            </div>
          )}
        </Card>
      </div>

      <div className="grid min-w-0 content-start gap-5">
        {post && (
          <Card>
            <CardHeader title="Status" actions={<StatusBadge status={status} />} description={post.author ? `Author: ${post.author}` : undefined} />
            <CardBody className="grid gap-2 text-[13px]">
              <div className="text-text-2">
                {post.published_at ? <>Published <LocalTime iso={post.published_at} /></> : post.scheduled_at ? <>Planned for <LocalTime iso={post.scheduled_at} /></> : "Not scheduled"}
              </div>
              {post.channels.map((k) => (
                <ResultRow key={k} brandId={brandId} postId={post.id} kind={k} r={post.results[k]} status={status} canAuthor={props.canAuthor} conn={props.channels.find((c) => c.kind === k)} deletable={props.deletable.includes(k)} />
              ))}
              {status === "failed" && props.canAuthor && (
                <>
                  <p className="text-[12px] text-text-2">Fix the problem (or edit and pick a new time above), then retry. The author, owner and approvers were notified.</p>
                  <Button size="sm" disabled={pending} onClick={() => act(() => transitionAction(brandId, post.id, "retry"), "Retrying now.")}>
                    Retry failed channels
                  </Button>
                </>
              )}
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Preview" />
          <CardBody>
            {channels.length ? (
              <>
                <Segmented className="mb-3 flex-wrap" options={channels.map((k) => ({ value: k, label: pubChannel(k)?.name.split(" ")[0] ?? k }))} value={channels.includes(preview) ? preview : channels[0]} onChange={setPreview} />
                <PhonePreview kind={channels.includes(preview) ? preview : channels[0]} name={props.brandName} text={textFor(channels.includes(preview) ? preview : channels[0])} media={media.map((id) => ({ id, video: !!props.assets.find((a) => a.id === id)?.mime.startsWith("video/") }))} firstComment={firstComment} />
                {(problems[channels.includes(preview) ? preview : channels[0]] ?? []).map((p) => (
                  <p key={p} className="mt-2 text-[12px] text-critical-ink">{p}</p>
                ))}
              </>
            ) : (
              <p className="text-[13px] text-text-3">Pick a channel to preview.</p>
            )}
          </CardBody>
        </Card>

        {post && <Activity brandId={brandId} postId={post.id} comments={props.comments} />}
        <ImageEditor
          brandId={brandId}
          asset={editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            if (editing) setMedia(media.map((m) => (m === editing.id ? id : m)));
            setEditing(null);
            setNotice("Edited copy saved to the library and attached. Save the post to keep it.");
            router.refresh();
          }}
        />
      </div>

      <Dialog open={pickOpen} onClose={() => setPickOpen(false)} title="Asset library" description={props.requireAssetApproval ? "Pick media in order. This brand only allows approved assets." : "Pick images, videos or a PDF (in order)."} size="xl" footer={<Button variant="primary" onClick={() => setPickOpen(false)}>Done</Button>}>
        {props.assets.length ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {props.assets.map((a) => {
              const i = media.indexOf(a.id);
              const blocked = props.requireAssetApproval && a.approval !== "approved" && i < 0;
              const k = kindOf(a.mime);
              return (
                <button key={a.id} type="button" disabled={blocked} onClick={() => setMedia(i >= 0 ? media.filter((m) => m !== a.id) : [...media, a.id])} className={cn("relative aspect-square overflow-hidden rounded-md border-2 bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40", i >= 0 ? "border-brand" : "border-transparent")} title={blocked ? `${a.filename} — not approved` : a.filename}>
                  {k === "video" ? <video src={assetUrl(a.id)} className="h-full w-full object-cover" muted preload="metadata" /> : k === "document" ? <DocTile name={a.filename} /> : <img src={assetUrl(a.id)} alt={a.filename} loading="lazy" className="h-full w-full object-cover" />}
                  {i >= 0 && <span className="absolute top-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white">{i + 1}</span>}
                  {a.approval !== "none" && <span className={cn("absolute right-1 bottom-1 rounded px-1 text-[10px] font-medium", a.approval === "approved" ? "bg-good-soft text-good-ink" : a.approval === "rejected" ? "bg-critical-soft text-critical-ink" : "bg-warning-soft text-warning-ink")}>{a.approval}</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-text-2">
            The library is empty. <Link className="text-link hover:underline" href={`/cx/publishing/assets?brand=${brandId}`}>Upload images or videos</Link> first.
          </p>
        )}
      </Dialog>
    </div>
  );
}

function ResultRow({ brandId, postId, kind, r, status, canAuthor, conn, deletable }: { brandId: string; postId: string; kind: string; r?: ChannelResult; status: PostStatus; canAuthor: boolean; conn?: { connected: boolean; reason: string | null }; deletable: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const tone = !r ? "neutral" : r.status === "published" || r.status === "manual" ? "good" : r.status === "failed" ? "critical" : "warning";
  const label = !r ? (conn?.connected ? "Will publish automatically" : "Channel not connected") : r.status === "manual" ? "Published manually" : r.status === "not_connected" ? "Not published" : r.status === "published" ? "Published" : r.status === "deleted" ? "Deleted" : "Failed";
  const done = r && ["published", "manual", "deleted"].includes(r.status);
  return (
    <div className="rounded-md border border-border px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <ChannelChip kind={kind} withName />
        <Badge tone={tone}>{label}</Badge>
      </div>
      {r?.error && <p className="mt-1 text-[12px] text-text-2">{r.error}</p>}
      {!r && !conn?.connected && conn?.reason && <p className="mt-1 text-[12px] text-text-3">{conn.reason}</p>}
      {r?.url && (
        <a href={r.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] text-link hover:underline">
          View post <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {canAuthor && r?.status === "published" && r.externalId && deletable && (
        <button
          type="button"
          disabled={pending}
          className="mt-1 ml-3 inline-flex items-center gap-1 text-[12px] text-critical-ink hover:underline"
          onClick={() =>
            confirm(`Delete this post from ${kind === "gbp" ? "Business Profile" : kind}? This cannot be undone.`) &&
            start(async () => {
              const res = await deletePublishedAction(brandId, postId, kind);
              if (!res.ok) setError(res.error);
              else router.refresh();
            })
          }
        >
          <Trash2 className="h-3 w-3" /> Delete from network
        </button>
      )}
      {error && <p className="mt-1 text-[12px] text-critical-ink">{error}</p>}
      {canAuthor && !done && status !== "draft" && (
        open ? (
          <div className="mt-2 flex gap-1">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Post URL (optional)" className="h-7 text-[12px]" />
            <Button size="sm" disabled={pending} onClick={() => start(async () => { await markManualAction(brandId, postId, kind, url); router.refresh(); })}>
              Save
            </Button>
          </div>
        ) : (
          <button type="button" className="mt-1 text-[12px] text-link hover:underline" onClick={() => setOpen(true)}>
            Mark as published manually
          </button>
        )
      )}
    </div>
  );
}

function Activity({ brandId, postId, comments }: { brandId: string; postId: string; comments: ComposerProps["comments"] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader title="Post activity" description="Every change, decision and publishing result, with comments." />
      <CardBody className="grid gap-3">
        {comments.length ? (
          <ol className="relative grid gap-3 border-l border-border pl-4">
            {comments.map((c) => (
              <li key={c.id} className="relative text-[12.5px]">
                <span className={cn("absolute top-1 -left-[21px] h-2.5 w-2.5 rounded-full border-2 border-surface", KIND_TONE[c.kind] ?? "bg-border-strong")} />
                <div className="text-text-2">
                  <span className="font-medium text-text">{c.author_name}</span> {KIND_LABEL[c.kind] ?? c.kind} · <LocalTime iso={c.created_at} />
                </div>
                {c.body && c.kind !== "schedule" && <p className={cn("mt-0.5 whitespace-pre-wrap", c.kind === "reject" || c.kind === "failed" ? "text-critical-ink" : "text-text")}>{c.body}</p>}
                {c.kind === "schedule" && c.body.startsWith("Scheduled for ") && <p className="mt-0.5 text-text">for <LocalTime iso={c.body.slice(14)} /></p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12.5px] text-text-3">No activity yet.</p>
        )}
        <div className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment" />
          <Button disabled={pending || !text.trim()} onClick={() => start(async () => { const r = await commentAction(brandId, postId, text); if (r.ok) { setText(""); router.refresh(); } })}>
            <MessageSquare className="h-4 w-4" />
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function AiSuggest({ brandId, text, channel, onUse, disabled }: { brandId: string; text: string; channel: string; onUse: (t: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [items, setItems] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <Sparkles className="h-3.5 w-3.5" /> Suggest captions
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Caption ideas for ${pubChannel(channel)?.name ?? channel}`} description="Generated from your draft; review before using." size="lg">
        <div className="grid gap-3">
          <Field label="Brief (optional)" htmlFor="ai-brief">
            <Input id="ai-brief" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Audience, tone, call to action…" />
          </Field>
          <div>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await suggestCaptionsAction(brandId, { text, channel, brief });
                  if (!r.ok) return setError(r.error);
                  setError(null);
                  if (r.data === null) setError("No AI key is configured on the server.");
                  else setItems(r.data);
                })
              }
            >
              {pending ? "Writing…" : "Suggest"}
            </Button>
          </div>
          {error && <Callout tone="critical">{error}</Callout>}
          {items?.map((t, i) => (
            <div key={i} className="rounded-md border border-border p-3 text-[13px]">
              <p className="whitespace-pre-wrap">{t}</p>
              <Button size="sm" className="mt-2" onClick={() => { onUse(t); setOpen(false); }}>
                Use this
              </Button>
            </div>
          ))}
        </div>
      </Dialog>
    </>
  );
}

function DocTile({ name }: { name: string }) {
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-[10.5px] text-text-2">
      <FileText className="h-5 w-5" />
      <span className="line-clamp-2 break-all">{name}</span>
    </span>
  );
}

const FOLD: Record<string, number> = { facebook: 480, instagram: 125, linkedin: 210, x: 10_000, youtube: 300, threads: 500, gbp: 300 };

/** Approximate mobile rendering of the post on each network (neutral styling, no network branding). */
function PhonePreview({ kind, name, text, media, firstComment }: { kind: string; name: string; text: string; media: { id: string; video: boolean }[]; firstComment: string }) {
  const [more, setMore] = useState(false);
  const fold = FOLD[kind] ?? 300;
  const shown = more || text.length <= fold ? text : `${text.slice(0, fold).trimEnd()}…`;
  const handle = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const mediaBox = media.length > 0 && (
    <div className={cn("grid gap-0.5 overflow-hidden bg-surface-3", kind === "instagram" ? "aspect-square" : "aspect-[4/3]", media.length > 1 && kind !== "instagram" && "grid-cols-2")}>
      {(kind === "instagram" ? media.slice(0, 1) : media.slice(0, 4)).map((m) =>
        m.video ? <video key={m.id} src={assetUrl(m.id)} className="h-full w-full object-cover" muted /> : <img key={m.id} src={assetUrl(m.id)} alt="" className="h-full w-full object-cover" />,
      )}
    </div>
  );
  const textEl = (
    <p className="px-3 py-2 text-[13px] break-words whitespace-pre-wrap">
      {kind === "instagram" && <span className="mr-1 font-semibold">{handle}</span>}
      {shown}
      {!more && text.length > fold && (
        <button type="button" className="ml-1 text-text-3" onClick={() => setMore(true)}>
          {kind === "instagram" ? "more" : "See more"}
        </button>
      )}
    </p>
  );
  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[22px] border-4 border-border-strong bg-surface shadow-card">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand-ink">{name.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] font-semibold">{kind === "instagram" ? handle : name}</div>
          <div className="text-[11px] text-text-3">{kind === "x" ? `@${handle} · now` : kind === "linkedin" ? "Company page · now" : kind === "youtube" ? "Community · now" : "Just now"}</div>
        </div>
      </div>
      {kind === "instagram" ? (
        <>
          {mediaBox || <div className="flex aspect-square items-center justify-center bg-surface-3 text-[12px] text-text-3">Image or video required</div>}
          {textEl}
        </>
      ) : (
        <>
          {textEl}
          {mediaBox}
        </>
      )}
      <div className="flex justify-around border-t border-border py-2 text-[11.5px] text-text-3">
        <span>Like</span>
        <span>Comment</span>
        <span>{kind === "x" ? "Repost" : "Share"}</span>
      </div>
      {firstComment.trim() && pubChannel(kind)?.firstComment && (
        <div className="border-t border-border px-3 py-2 text-[12px]">
          <span className="font-semibold">{kind === "instagram" ? handle : name}</span> <span className="whitespace-pre-wrap">{firstComment}</span>
          <div className="text-[11px] text-text-3">{kind === "x" ? "Reply" : "First comment"}</div>
        </div>
      )}
      <div className="border-t border-border px-3 py-1.5 text-center text-[11px] text-text-3">Preview — actual rendering varies by app</div>
    </div>
  );
}
