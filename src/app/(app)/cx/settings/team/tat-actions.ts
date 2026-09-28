"use server";

import { adminAction } from "@/lib/cx/admin/guard";
import type { SlaRule } from "@/lib/cx/admin/pure/sla";
import { deleteEscalation, deleteSlaRule, moveSlaRule, saveEscalation, saveSlaRule, type Escalation } from "@/lib/cx/admin/sla";

/** TAT rules and escalation matrix (WP2) on the Team & SLAs page. */
const P = "/cx/settings/team";
const act = <T,>(brand: string, fn: (u: { id: string; name: string }) => Promise<T>) => adminAction(brand, "page:settings.team", P, fn);

export type TatRuleInput = Omit<SlaRule, "id" | "position"> & { id?: string };
export const saveTatRuleAction = async (brand: string, r: TatRuleInput) => act(brand, (u) => saveSlaRule(brand, r, u));
export const deleteTatRuleAction = async (brand: string, id: string) => act(brand, (u) => deleteSlaRule(brand, id, u));
export const moveTatRuleAction = async (brand: string, id: string, dir: -1 | 1) => act(brand, () => moveSlaRule(brand, id, dir));
export const saveEscalationAction = async (brand: string, e: Omit<Escalation, "id"> & { id?: string }) => act(brand, (u) => saveEscalation(brand, e, u));
export const deleteEscalationAction = async (brand: string, id: string) => act(brand, (u) => deleteEscalation(brand, id, u));
