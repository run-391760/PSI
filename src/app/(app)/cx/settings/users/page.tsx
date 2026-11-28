import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/shell/page";
import { Leaderboard } from "@/components/cx/insights/leaderboard";
import { Badge } from "@/components/ui/badge";
import { getLeaderboard, LEADERBOARD_DAYS } from "@/lib/cx/insights/leaderboard";
import { listTeams } from "@/lib/cx/insights/team";
import { getIpSettings } from "@/lib/cx/admin/ip";
import { listRoles } from "@/lib/cx/admin/roles";
import { existingUserCandidates, listUserGroups, listUsers } from "@/lib/cx/admin/users";
import { settingsPage, SettingsHeader } from "../_admin/settings-page";
import { UsersClient } from "./users-client";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { el, ctx } = await settingsPage(sp, { title: "Users", path: "/cx/settings/users", perm: "page:settings.team" });
  if (!ctx) return el;
  const id = ctx.brand.id;
  const lb = (LEADERBOARD_DAYS as readonly number[]).includes(Number(sp.lb)) ? Number(sp.lb) : 30;
  const [users, groups, roles, teams, candidates, ip, leaders] = await Promise.all([listUsers(id), listUserGroups(id), listRoles(id), listTeams(id), existingUserCandidates(id, ctx.user.id), getIpSettings(id), getLeaderboard(id, lb)]);
  const link = "text-[12px] font-semibold tracking-[0.08em] text-text-2 uppercase hover:text-link";
  return (
    <Page>
      <div className="mb-2 flex flex-wrap justify-end gap-x-6 gap-y-1">
        <Link href={`/cx/settings/users/ip?brand=${id}`} className={link}>IP whitelisting{ip.enabled && <Badge tone="good" className="ml-1.5 tracking-normal normal-case">On</Badge>}</Link>
        <Link href={`/cx/settings/roles?brand=${id}`} className={link}>Role settings</Link>
      </div>
      <SettingsHeader title="Users" ctx={ctx} description="Everyone who works on this brand, their role and who added them. People without an account get an invite link."
        meta={<><Badge tone="info">{users.filter((u) => u.userId).length} user{users.filter((u) => u.userId).length === 1 ? "" : "s"}</Badge>{users.some((u) => !u.userId) && <Badge tone="warning">{users.filter((u) => !u.userId).length} invite{users.filter((u) => !u.userId).length === 1 ? "" : "s"} pending</Badge>}<Badge>{groups.length} user group{groups.length === 1 ? "" : "s"}</Badge></>} />
      <UsersClient
        brand={id}
        me={ctx.user.id}
        users={users}
        groups={groups}
        roles={roles.map((r) => ({ id: r.id, name: r.name }))}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        candidates={candidates}
        canEdit={ctx.canEdit}
      />
      <Leaderboard rows={leaders} days={lb} href={(d) => `/cx/settings/users?brand=${id}&lb=${d}#leaderboard`} />
    </Page>
  );
}
