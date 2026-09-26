"use server";

import { revalidatePath } from "next/cache";
import { actionError } from "@/app/(app)/projects/actions";
import { requireUser } from "@/lib/auth";
import {
  addGroup,
  addKeywords,
  addNegatives,
  applyCrossNegatives,
  createCampaign,
  deleteCampaign,
  deleteGroup,
  regroupCampaign,
  removeDuplicates,
  removeKeywords,
  removeNegatives,
  renameGroup,
  updateCampaign,
  updateKeywords,
} from "@/lib/keywords/ppc";
import type { AdMatch } from "@/lib/keywords/ppc-model";
import type { ActionResult } from "@/lib/keywords/types";

async function run<T>(fn: (ownerId: string) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const user = await requireUser();
    const data = await fn(user.id);
    revalidatePath("/ppc-keyword-tool");
    return { ok: true, data };
  } catch (e) {
    return actionError(e);
  }
}
const strs = (a: unknown) => (Array.isArray(a) ? a.map(String) : []);

export async function createCampaignAction(input: { name: string; db: string; keywords: string[]; autoGroup: boolean; match: AdMatch }) {
  return run((o) => createCampaign(o, { name: String(input.name ?? ""), db: String(input.db ?? "US"), keywords: strs(input.keywords), autoGroup: input.autoGroup !== false, match: input.match }));
}
export async function updateCampaignAction(id: string, input: { name?: string; ctr?: number }) {
  return run((o) => updateCampaign(o, String(id), { name: input.name == null ? undefined : String(input.name), ctr: input.ctr == null ? undefined : Number(input.ctr) }));
}
export async function deleteCampaignAction(id: string) {
  return run((o) => deleteCampaign(o, String(id)));
}
export async function addGroupAction(campaignId: string, name: string) {
  return run((o) => addGroup(o, String(campaignId), String(name ?? "")));
}
export async function renameGroupAction(campaignId: string, groupId: string, name: string) {
  return run((o) => renameGroup(o, String(campaignId), String(groupId), String(name ?? "")));
}
export async function deleteGroupAction(campaignId: string, groupId: string) {
  return run((o) => deleteGroup(o, String(campaignId), String(groupId)));
}
export async function addKeywordsAction(campaignId: string, groupId: string, keywords: string[], match: AdMatch) {
  return run((o) => addKeywords(o, String(campaignId), String(groupId), strs(keywords), match));
}
export async function updateKeywordsAction(campaignId: string, ids: string[], change: { match?: AdMatch; groupId?: string }) {
  return run((o) => updateKeywords(o, String(campaignId), strs(ids), { match: change.match, groupId: change.groupId ? String(change.groupId) : undefined }));
}
export async function removeKeywordsAction(campaignId: string, ids: string[]) {
  return run((o) => removeKeywords(o, String(campaignId), strs(ids)));
}
export async function addNegativesAction(campaignId: string, groupId: string | null, keywords: string[], match: AdMatch) {
  return run((o) => addNegatives(o, String(campaignId), groupId ? String(groupId) : null, strs(keywords), match));
}
export async function removeNegativesAction(campaignId: string, ids: string[]) {
  return run((o) => removeNegatives(o, String(campaignId), strs(ids)));
}
export async function regroupAction(campaignId: string) {
  return run((o) => regroupCampaign(o, String(campaignId)));
}
export async function crossNegativesAction(campaignId: string) {
  return run((o) => applyCrossNegatives(o, String(campaignId)));
}
export async function removeDuplicatesAction(campaignId: string) {
  return run((o) => removeDuplicates(o, String(campaignId)));
}
