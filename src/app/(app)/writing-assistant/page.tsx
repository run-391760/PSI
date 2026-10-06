import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { migrateWritingDocuments } from "@/lib/optimizer/migrate";

/**
 * The SEO Writing Assistant was folded into the Pre-Publish Optimizer. Visiting it migrates the
 * user's documents into optimizer drafts (once per document) and opens the optimizer, which shows the
 * most recently edited draft (the last migrated document, or the user's latest existing draft).
 */
export default async function WritingAssistantPage() {
  const user = await requirePageUser();
  await migrateWritingDocuments(user.id);
  redirect("/optimizer");
}
