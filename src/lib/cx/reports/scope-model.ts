import { sourceOfProfile, type ScopeOptions, type ScopeValue } from "@/lib/cx/ops/scope-model";
import type { Entity } from "./model";

/**
 * Report scope on top of the shared ScopePicker (`?scope=`, see @/lib/cx/ops/scope-model): which entities
 * (ticked clusters, topics and profiles) the report compares, and which entities a mention or ticket
 * belongs to. With nothing ticked the report compares every listening topic plus "Owned profiles" (tickets
 * that did not come from a mention) and "Other mentions" (mentions without a topic).
 */
export type MentionRef = { topic_id: string | null; source: string };
export type TicketRef = { channel_id: string | null; channel_kind: string; mention_topic: string | null; from_mention: boolean };
export type Scope = {
  value: ScopeValue;
  options: ScopeOptions;
  entities: Entity[];
  label: string;
  isDefault: boolean;
  mentionEntities: (m: MentionRef) => string[];
  /** `dedupe`: tickets that came from a mention are counted through the mention (conversation reports). */
  ticketEntities: (t: TicketRef, dedupe: boolean) => string[];
  topicKeywords: string[];
};
/** Pure part of the scope resolution (fixture-tested). */
export function buildScope(value: ScopeValue, options: ScopeOptions, brandName: string, topicKeywords: string[] = []): Scope {
  const clusters = options.clusters.filter((c) => value.clusters.includes(c.id)).map((c) => ({ ...c, ch: new Set(c.channelIds), src: new Set(c.sources), tp: new Set(c.topicIds) }));
  const topics = options.topics.filter((t) => value.topics.includes(t.id));
  const profiles = options.profiles.filter((p) => value.profiles.includes(p.id)).map((p) => ({ ...p, source: sourceOfProfile(p.id) }));

  if (clusters.length + topics.length + profiles.length > 0) {
    const entities: Entity[] = [
      ...clusters.map((c) => ({ id: c.id, name: `${c.name} (C)`, kind: "cluster" as const })),
      ...topics.map((t) => ({ id: t.id, name: t.name, kind: "topic" as const })),
      ...profiles.map((p) => ({ id: p.id, name: p.name, kind: "profile" as const })),
    ];
    return {
      value,
      options,
      entities,
      isDefault: false,
      label: entities.map((e) => e.name).join(", "),
      topicKeywords,
      mentionEntities: (m) => [
        ...clusters.filter((c) => c.src.has(m.source) || (m.topic_id != null && c.tp.has(m.topic_id))).map((c) => c.id),
        ...topics.filter((t) => t.id === m.topic_id).map((t) => t.id),
        ...profiles.filter((p) => p.source === m.source).map((p) => p.id),
      ],
      ticketEntities: (t, dedupe) => {
        const out: string[] = [];
        for (const c of clusters) {
          const own = t.channel_id ? c.ch.has(t.channel_id) : c.src.has(t.channel_kind);
          const viaTopic = t.mention_topic != null && c.tp.has(t.mention_topic);
          // A ticket made from a mention this cluster already counts is not a second conversation.
          if (dedupe && t.from_mention && (viaTopic || (!t.channel_id && c.src.has(t.channel_kind)))) continue;
          if (own || viaTopic) out.push(c.id);
        }
        if (!dedupe || !t.from_mention) for (const x of topics) if (t.mention_topic === x.id) out.push(x.id);
        for (const p of profiles) {
          if (p.type === "channel" && t.channel_id === p.id) out.push(p.id);
          if (p.source && !t.channel_id && t.channel_kind === p.source && !(dedupe && t.from_mention)) out.push(p.id);
        }
        return out;
      },
    };
  }

  const known = new Set(options.topics.map((t) => t.id));
  const entities: Entity[] = [...options.topics.map((t) => ({ id: t.id, name: t.name, kind: "topic" as const })), { id: "owned", name: "Owned profiles", kind: "owned" }, { id: "other", name: "Other mentions", kind: "other" }];
  return {
    value,
    options,
    entities,
    isDefault: true,
    label: brandName,
    topicKeywords,
    mentionEntities: (m) => [m.topic_id && known.has(m.topic_id) ? m.topic_id : "other"],
    ticketEntities: (t, dedupe) => {
      if (t.from_mention) return dedupe ? [] : [t.mention_topic && known.has(t.mention_topic) ? t.mention_topic : "other"];
      return ["owned"];
    },
  };
}
