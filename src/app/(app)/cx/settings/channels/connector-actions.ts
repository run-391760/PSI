"use server";

import { isConnector, saveConnectorChannel, syncConnector } from "@/lib/cx/admin/connectors";
import { adminAction } from "@/lib/cx/admin/guard";
import { query } from "@/lib/db";
import { assertIpAllowed } from "@/lib/cx/admin/ip";
import { claimProfile } from "@/lib/cx/admin/profiles";
import { AppError } from "@/lib/domain";

/** Free connectors (Discord, Discourse, Telegram) on Settings → Channels (WP2). */
const P = "/cx/settings/channels";
const act = <T,>(brand: string, fn: (user: { id: string; name: string; email: string }) => Promise<T>) => adminAction(brand, "page:settings.channels", P, fn);

export const saveConnectorAction = async (brand: string, kind: string, name: string, input: { token: string; channelId?: string; base?: string; username?: string }, id?: string) =>
  act(brand, async (user) => {
    if (!isConnector(kind)) throw new AppError("Unknown connector.");
    await assertIpAllowed(brand, user.id);
    const channelId = await saveConnectorChannel(brand, kind, name.trim().slice(0, 80), input, id);
    await claimProfile(brand, channelId, user.id);
    return channelId;
  });

export const syncConnectorAction = async (brand: string, id: string) =>
  act(brand, async (user) => {
    await assertIpAllowed(brand, user.id);
    const [ch] = await query<{ id: string; project_id: string; kind: string; config: Record<string, unknown>; secret_enc: string | null }>("SELECT id,project_id,kind,config,secret_enc FROM cx_channels WHERE id=$1 AND project_id=$2", [id, brand]);
    if (!ch) throw new AppError("Channel not found.", 404);
    return syncConnector(ch);
  });
