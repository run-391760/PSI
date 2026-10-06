import { redirect } from "next/navigation";
import { parseTemplateKeywords } from "@/lib/content/template";
import { database } from "@/lib/domain";

/** The SEO Content Template became the optimizer's Content Planning brief generator: keep old links working. */
export default async function SeoContentTemplatePage({ searchParams }: PageProps<"/seo-content-template">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? parseTemplateKeywords(sp.q)[0] ?? "" : "";
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (typeof sp.db === "string" && sp.db) params.set("db", database(sp.db).code);
  const qs = params.toString();
  redirect(`/optimizer/content-planning${qs ? `?${qs}` : ""}`);
}
