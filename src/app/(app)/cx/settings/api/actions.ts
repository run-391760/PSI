"use server";

import { createToken, revokeToken } from "@/lib/cx/admin/api";
import { adminAction } from "@/lib/cx/admin/guard";
import { deleteExternalApi, deleteWebhook, externalData, redeliver, rotateWebhookSecret, saveExternalApi, saveWebhook, testWebhook } from "@/lib/cx/admin/webhooks";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";

const P = "/cx/settings/api";
const act = <T,>(brand: string, fn: (u: { id: string; name: string }) => Promise<T>) => adminAction(brand, "page:settings.api", P, fn);

/** Returns the plain token once; only its hash is stored. */
export const createTokenAction = async (brand: string, kind: "account" | "user", name: string) => act(brand, (u) => createToken(brand, kind, name, u.id, u));
export const revokeTokenAction = async (brand: string, id: string) => act(brand, (u) => revokeToken(brand, id, u));

export const saveWebhookAction = async (brand: string, w: { id?: string; name: string; url: string; events: string[]; active: boolean }) => act(brand, (u) => saveWebhook(brand, w, u));
export const deleteWebhookAction = async (brand: string, id: string) => act(brand, (u) => deleteWebhook(brand, id, u));
export const rotateSecretAction = async (brand: string, id: string) => act(brand, (u) => rotateWebhookSecret(brand, id, u));
export const testWebhookAction = async (brand: string, id: string) => act(brand, () => testWebhook(brand, id));
export const redeliverAction = async (brand: string, deliveryId: string) => act(brand, () => redeliver(brand, deliveryId));

export type ExternalApiInput = { id?: string; name: string; target: "ticket" | "contact"; method: "GET" | "POST"; url: string; body: string; headers: string; mapping: { label: string; path: string }[]; active: boolean };
export const saveExternalApiAction = async (brand: string, a: ExternalApiInput) => act(brand, (u) => saveExternalApi(brand, a, u));
export const deleteExternalApiAction = async (brand: string, id: string) => act(brand, () => deleteExternalApi(brand, id));
/** Try an External API against the most recent ticket (or its contact). */
export const testExternalApiAction = async (brand: string, id: string, target: "ticket" | "contact") =>
  act(brand, async () => {
    const [t] = await query<{ id: string; contact_id: string | null; number: number }>("SELECT id,contact_id,number FROM cx_tickets WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1", [brand]);
    const subject = target === "ticket" ? t?.id : t?.contact_id;
    if (!subject) throw new AppError(`There's no ${target} in this brand to test with yet.`);
    const [r] = await externalData(brand, target, subject, id);
    return { sample: `ticket #${t.number}${target === "contact" ? "'s contact" : ""}`, result: r ?? null };
  });
