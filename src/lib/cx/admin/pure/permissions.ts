/** Roles and permissions (pure, fixture-tested). Page permissions gate routes; action permissions gate operations. */
export const PAGE_PERMS = [
  { key: "page:inbox", label: "Inbox" },
  { key: "page:contacts", label: "Contacts" },
  { key: "page:listening", label: "Listening & crisis" },
  { key: "page:publishing", label: "Publishing" },
  { key: "page:analytics", label: "Social analytics" },
  { key: "page:insights", label: "Reports & dashboards" },
  { key: "page:surveys", label: "Surveys" },
  { key: "page:quality", label: "Quality assessment" },
  { key: "page:knowledge", label: "Knowledge base" },
  { key: "page:settings.channels", label: "Settings: channels" },
  { key: "page:settings.team", label: "Settings: team & SLAs" },
  { key: "page:settings.automation", label: "Settings: automation" },
  { key: "page:settings.fields", label: "Settings: fields" },
  { key: "page:settings.queue", label: "Settings: queue" },
  { key: "page:settings.roles", label: "Settings: roles & security" },
  { key: "page:settings.alerts", label: "Settings: alerts" },
  { key: "page:settings.api", label: "Settings: API & webhooks" },
] as const;

export const ACTION_PERMS = [
  { key: "reply_public", label: "Public reply", group: "Replies" },
  { key: "reply_private", label: "Private reply / internal note", group: "Replies" },
  { key: "status:open", label: "Set Open", group: "CRM status" },
  { key: "status:wip", label: "Set Work in progress", group: "CRM status" },
  { key: "status:follow_up", label: "Set Follow-up", group: "CRM status" },
  { key: "status:pending", label: "Set Pending", group: "CRM status" },
  { key: "status:on_hold", label: "Set On hold", group: "CRM status" },
  { key: "status:solved", label: "Set Resolved", group: "CRM status" },
  { key: "status:closed", label: "Set Closed", group: "CRM status" },
  { key: "status:ignored", label: "Set Ignored", group: "CRM status" },
  { key: "assign", label: "Assign / reassign tickets", group: "Tickets" },
  { key: "bulk", label: "Bulk actions", group: "Tickets" },
  { key: "quick_actions", label: "Run Quick Actions", group: "Tickets" },
  { key: "classify", label: "Classify and edit fields", group: "Tickets" },
  { key: "content_tags", label: "Add / set tags", group: "Tickets" },
  { key: "download_attachments", label: "Download attachments", group: "Tickets" },
  { key: "export", label: "Export tickets and reports", group: "Data" },
  { key: "delete", label: "Delete tickets and contacts", group: "Data" },
  { key: "view_pii", label: "See unmasked email / phone", group: "Privacy" },
  { key: "reveal_pii", label: "Reveal masked data (logged)", group: "Privacy" },
  { key: "manage_queue", label: "Pause agents, reset queues", group: "Admin" },
] as const;

export type PagePerm = (typeof PAGE_PERMS)[number]["key"];
export type ActionPerm = (typeof ACTION_PERMS)[number]["key"];
export type Permission = PagePerm | ActionPerm;
export type BaseRole = "owner" | "admin" | "supervisor" | "agent" | "viewer";

const ALL_PAGES = PAGE_PERMS.map((p) => p.key) as PagePerm[];
const ALL_ACTIONS = ACTION_PERMS.map((p) => p.key) as ActionPerm[];
const WORK_PAGES: PagePerm[] = ["page:inbox", "page:contacts", "page:knowledge"];

/** Defaults of the built-in roles. */
export const BUILT_IN: Record<BaseRole, { pages: PagePerm[]; actions: ActionPerm[] }> = {
  owner: { pages: ALL_PAGES, actions: ALL_ACTIONS },
  admin: { pages: ALL_PAGES, actions: ALL_ACTIONS },
  supervisor: {
    pages: ALL_PAGES.filter((p) => p !== "page:settings.roles" && p !== "page:settings.api"),
    actions: ALL_ACTIONS.filter((a) => a !== "delete" && a !== "view_pii"),
  },
  agent: {
    pages: [...WORK_PAGES, "page:listening"],
    actions: ["reply_public", "reply_private", "status:open", "status:wip", "status:follow_up", "status:pending", "status:on_hold", "status:solved", "quick_actions", "classify", "content_tags", "download_attachments"],
  },
  viewer: { pages: ["page:insights", "page:analytics", "page:listening"], actions: [] },
};

export type RoleDef = { id: string; name: string; pages: string[]; actions: string[] };

/** Effective permission set: a custom role replaces the built-in defaults, except owners/admins keep everything. */
export function effectivePermissions(base: BaseRole | null, custom: RoleDef | null): Set<string> {
  if (!base) return new Set();
  if (base === "owner" || base === "admin") return new Set<string>([...BUILT_IN.admin.pages, ...BUILT_IN.admin.actions]);
  if (custom) {
    const valid = new Set<string>([...ALL_PAGES, ...ALL_ACTIONS]);
    return new Set([...custom.pages, ...custom.actions].filter((p) => valid.has(p)));
  }
  return new Set<string>([...BUILT_IN[base].pages, ...BUILT_IN[base].actions]);
}

export function hasPermission(perms: Set<string>, p: Permission | `status:${string}`) {
  return perms.has(p);
}

/** Route → page permission, for page guards ("/cx/settings/queue" → "page:settings.queue"). */
export function pagePermForPath(path: string): PagePerm | null {
  const m = path.match(/^\/cx\/(?:settings\/([a-z-]+)|([a-z-]+))/);
  if (!m) return null;
  if (m[1]) {
    const key = `page:settings.${m[1]}` as PagePerm;
    return ALL_PAGES.includes(key) ? key : null;
  }
  const map: Record<string, PagePerm> = { inbox: "page:inbox", contacts: "page:contacts", listening: "page:listening", crisis: "page:listening", publishing: "page:publishing", analytics: "page:analytics", insights: "page:insights", reports: "page:insights", dashboards: "page:insights", surveys: "page:surveys", quality: "page:quality", knowledge: "page:knowledge" };
  return map[m[2]] ?? null;
}

export type ImportUserRow = { email: string; role: "admin" | "supervisor" | "agent" | "viewer"; team: string | null; customRole: string | null };
/** Parse a bulk user sheet: email, role (admin/supervisor/agent/viewer or a custom role name), team. */
export function parseUserImport(rows: string[][], customRoles: string[]): { rows: ImportUserRow[]; errors: string[] } {
  const out: ImportUserRow[] = [], errors: string[] = [];
  const base = ["admin", "supervisor", "agent", "viewer"];
  const body = rows[0] && /e-?mail/i.test(rows[0][0] ?? "") ? rows.slice(1) : rows;
  body.forEach((r, i) => {
    const email = (r[0] ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errors.push(`Row ${i + 1}: "${r[0] ?? ""}" is not an email address.`);
    const roleRaw = (r[1] ?? "agent").trim();
    const custom = customRoles.find((c) => c.toLowerCase() === roleRaw.toLowerCase()) ?? null;
    const role = base.includes(roleRaw.toLowerCase()) ? (roleRaw.toLowerCase() as ImportUserRow["role"]) : "agent";
    if (!custom && roleRaw && !base.includes(roleRaw.toLowerCase())) errors.push(`Row ${i + 1}: unknown role "${roleRaw}", using Agent.`);
    out.push({ email, role, team: (r[2] ?? "").trim() || null, customRole: custom });
  });
  return { rows: out, errors };
}
