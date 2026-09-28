"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { deleteCanned, deleteRule, moveRule, saveCanned, saveRule, toggleRule, type RuleInput } from "@/lib/cx/inbox/automation";
import { brandUser } from "@/lib/cx/inbox/guard";
import { evaluateRules, type Rule } from "@/lib/cx/inbox/rules";
import { analyzeText } from "@/lib/cx/ai";

async function run<T>(brand: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    await brandUser(brand);
    const data = await fn();
    revalidatePath("/cx/settings/automation");
    return { ok: true, data };
  } catch (e) {
    return actionError(e);
  }
}

export const saveRuleAction = async (brand: string, r: RuleInput) => run(brand, () => saveRule(brand, r));
export const deleteRuleAction = async (brand: string, id: string) => run(brand, () => deleteRule(brand, id));
export const toggleRuleAction = async (brand: string, id: string, active: boolean) => run(brand, () => toggleRule(brand, id, active));
export const moveRuleAction = async (brand: string, id: string, dir: -1 | 1) => run(brand, () => moveRule(brand, id, dir));
export const saveCannedAction = async (brand: string, c: { id?: string; title: string; shortcut: string; body: string }) => run(brand, () => saveCanned(brand, c));
export const deleteCannedAction = async (brand: string, id: string) => run(brand, () => deleteCanned(brand, id));

/** Dry-run: what the current rules would do with a sample message. */
export async function testRulesAction(brand: string, rules: Rule[], sample: { channel: string; subject: string; body: string; email: string }) {
  return run(brand, async () => {
    const a = analyzeText(`${sample.subject}\n${sample.body}`);
    const r = evaluateRules(rules, { ...sample, intent: a.intent, sentiment: a.sentiment, language: a.language });
    return { ...r, analysis: a };
  });
}
