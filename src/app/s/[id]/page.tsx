import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicSurvey } from "@/lib/cx/insights/surveys";
import { PublicSurveyForm } from "@/components/cx/insights/public-survey";

export const metadata: Metadata = { title: "Feedback", robots: { index: false, follow: false } };

/** Public survey page (no sign-in). ?t=<token> links the response to a ticket. */
export default async function PublicSurveyPage({ params, searchParams }: PageProps<"/s/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const s = await publicSurvey(id);
  if (!s) notFound();
  const token = typeof sp.t === "string" ? sp.t.slice(0, 64) : undefined;
  return (
    <main className="flex min-h-screen items-start justify-center bg-bg px-4 py-10 sm:py-16">
      <div className="w-full max-w-xl">
        <div className="mb-4 text-center text-[13px] font-semibold tracking-wide text-text-2 uppercase">{s.brand}</div>
        <div className="rounded-xl border border-border bg-surface p-5 shadow-card sm:p-8">
          {s.status !== "active" ? (
            <p className="py-8 text-center text-[15px] text-text-2">This survey is closed. Thank you for your interest.</p>
          ) : (
            <PublicSurveyForm id={s.id} kind={s.kind} question={s.question} questions={s.questions} token={token} />
          )}
        </div>
        <p className="mt-4 text-center text-[12px] text-text-3">Your answers are shared only with {s.brand}.</p>
      </div>
    </main>
  );
}
