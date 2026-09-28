"use server";

import { adminAction } from "@/lib/cx/admin/guard";
import { deleteClassification, deleteField, importClassifications, saveClassification, saveField, setFieldOptions, type ClassificationNode, type FieldInput } from "@/lib/cx/admin/fields";
import { parseFieldsCsv, parseOptionsCsv } from "@/lib/cx/admin/pure/fields";

const P = "/cx/settings/fields";
const act = <T,>(brand: string, fn: (u: { id: string; name: string }) => Promise<T>) => adminAction(brand, "page:settings.fields", P, fn);

export const saveClassificationAction = async (brand: string, c: { id?: string; parentId: string | null; label: string; sentiment: ClassificationNode["sentiment"]; hidden: boolean }) => act(brand, () => saveClassification(brand, c));
export const deleteClassificationAction = async (brand: string, id: string) => act(brand, () => deleteClassification(brand, id));
export const importClassificationsAction = async (brand: string, csv: string) => act(brand, () => importClassifications(brand, csv));
export const saveFieldAction = async (brand: string, f: FieldInput) => act(brand, (u) => saveField(brand, f, u));
export const deleteFieldAction = async (brand: string, id: string) => act(brand, (u) => deleteField(brand, id, u));
export const setOptionsAction = async (brand: string, id: string, options: string[]) => act(brand, () => setFieldOptions(brand, id, options, "replace"));
export const importOptionsAction = async (brand: string, id: string, csv: string, mode: "replace" | "append") => act(brand, () => setFieldOptions(brand, id, parseOptionsCsv(csv), mode));
export const importFieldsAction = async (brand: string, csv: string) =>
  act(brand, async (u) => {
    const rows = parseFieldsCsv(csv);
    let saved = 0;
    const errors: string[] = [];
    for (const r of rows.slice(0, 300)) {
      try { await saveField(brand, { ...r, group: r.group === "system" ? "additional_info" : r.group }, u); saved++; } catch (e) { errors.push(`${r.label}: ${e instanceof Error ? e.message : e}`); }
    }
    return { saved, errors };
  });
