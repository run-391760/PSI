import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { formChannel } from "@/lib/cx/inbox/chat";
import { PublicForm } from "@/components/cx/inbox/public-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ channelId: string }> }): Promise<Metadata> {
  const ch = await formChannel((await params).channelId).catch(() => null);
  return { title: ch ? `${ch.config.title} · ${ch.brand}` : "Form", robots: { index: false } };
}

/** Hosted web form. Submissions create tickets in the brand's inbox. */
export default async function FormPage({ params, searchParams }: { params: Promise<{ channelId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { channelId } = await params;
  const sp = await searchParams;
  const ch = await formChannel(channelId).catch(() => null);
  return (
    <main className="min-h-dvh bg-bg px-4 py-10">
      <div className="mx-auto w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-card">
        {!ch ? (
          <div className="text-center">
            <h1 className="text-[18px] font-semibold text-text">Form unavailable</h1>
            <p className="mt-1 text-[13px] text-text-2">This form is not active.</p>
          </div>
        ) : sp.sent ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-good-ink" />
            <h1 className="mt-3 text-[18px] font-semibold text-text">Message sent</h1>
            <p className="mt-1 text-[13.5px] text-text-2">{ch.config.success}</p>
          </div>
        ) : (
          <>
            <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-text-3">{ch.brand}</div>
            <h1 className="text-[20px] font-semibold text-text">{ch.config.title}</h1>
            {ch.config.intro && <p className="mt-1 text-[13.5px] text-text-2">{ch.config.intro}</p>}
            <PublicForm channelId={ch.id} askPhone={ch.config.askPhone} askSubject={ch.config.askSubject} color={ch.config.color} success={ch.config.success} initialError={sp.error ?? null} />
          </>
        )}
      </div>
      <p className="mt-4 text-center text-[11.5px] text-text-3">Powered by SynapseSEO CX</p>
    </main>
  );
}
