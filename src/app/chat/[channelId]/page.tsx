import type { Metadata } from "next";
import Script from "next/script";
import { chatChannel } from "@/lib/cx/inbox/chat";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ channelId: string }> }): Promise<Metadata> {
  const ch = await chatChannel((await params).channelId).catch(() => null);
  return { title: ch ? `Chat with ${ch.brand}` : "Chat", robots: { index: false } };
}

/** Hosted full-page live chat (shareable link); uses the same script as the embeddable widget. */
export default async function ChatPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const ch = await chatChannel(channelId).catch(() => null);
  if (!ch)
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg p-6 text-center">
        <div>
          <h1 className="text-[18px] font-semibold text-text">Chat unavailable</h1>
          <p className="mt-1 text-[13px] text-text-2">This chat link is not active.</p>
        </div>
      </main>
    );
  return (
    <main className="min-h-dvh bg-bg">
      <noscript>
        <p className="p-6 text-center text-[13px] text-text-2">Live chat needs JavaScript.</p>
      </noscript>
      <Script src={`/api/cx/chat/widget?c=${encodeURIComponent(ch.id)}&mode=page`} strategy="afterInteractive" />
    </main>
  );
}
