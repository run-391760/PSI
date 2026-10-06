import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { migrateWritingDocuments } from "@/lib/optimizer/migrate";

/** Old Writing Assistant document links open the optimizer draft the document was migrated to. */
export default async function WritingAssistantDocPage({ params }: PageProps<"/writing-assistant/[id]">) {
  const user = await requirePageUser();
  const { id } = await params;
  const migrated = await migrateWritingDocuments(user.id);
  const draftId = migrated.get(id);
  redirect(draftId ? `/optimizer?doc=${encodeURIComponent(draftId)}` : "/optimizer");
}
