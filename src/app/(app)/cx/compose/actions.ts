"use server";

import { runOps } from "@/lib/cx/ops/run";
import { composeEmail, type ComposeInput } from "@/lib/cx/ops/compose";

export const composeEmailAction = async (brand: string, input: ComposeInput) => runOps(brand, (u) => composeEmail(brand, u, input), { paths: ["/cx/compose", "/cx/inbox"] });
