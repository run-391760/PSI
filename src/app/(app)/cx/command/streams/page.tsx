import { Columns3, LayoutDashboard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { CommandWall } from "@/components/cx/listening/command-wall";
import { NoBrand } from "@/components/cx/listening/no-brand";
import { BoardEditor, StreamColumns } from "@/components/cx/listening/streams-board";
import { Page, PageHeader } from "@/components/shell/page";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { listBoards, streamItems, type StreamDef } from "@/lib/cx/listening/command";
import { listTopics } from "@/lib/cx/listening/data";
import { LISTEN_SOURCES, sourceLabel } from "@/lib/cx/listening/sources";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Streams" };
export const dynamic = "force-dynamic";

export default async function StreamsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Streams" />;
  const [boards, topics] = await Promise.all([listBoards(brand.id), listTopics(brand.id)]);
  const board = boards.find((b) => b.id === sp.board) ?? boards[0];
  const topicOpts = topics.map((t) => ({ value: t.id, label: t.name }));
  const sourceOpts = LISTEN_SOURCES.map((s) => ({ value: s, label: sourceLabel(s) }));
  const streams = board ? await Promise.all(board.streams.map(async (s: StreamDef) => ({ ...s, items: await streamItems(brand.id, s, 30) }))) : [];
  return (
    <Page wide>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Command centre", href: `/cx/command?brand=${brand.id}` }, { label: "Streams" }]}
        title="Streams"
        subject={brand.name}
        description="Social wall: boards of live mention streams filtered by topic, source, sentiment or keyword. Share, open or ticket any post from the wall."
        actions={
          <>
            <BrandSwitcher brands={switcher} current={brand.id} />
            <ButtonLink href={`/cx/command?brand=${brand.id}`} variant="secondary"><LayoutDashboard className="h-4 w-4" /> Command centre</ButtonLink>
            <BoardEditor brandId={brand.id} topics={topicOpts} sources={sourceOpts} />
          </>
        }
      />
      {!board ? (
        <Card>
          <EmptyState icon={<Columns3 className="h-5 w-5" />} title="No boards yet" description="Create a board with streams such as “All mentions”, “Negative” and one per competitor. It opens as a full-screen wall." action={<BoardEditor brandId={brand.id} topics={topicOpts} sources={sourceOpts} />} />
        </Card>
      ) : (
        <>
          {boards.length > 1 && (
            <nav className="mb-3 flex flex-wrap gap-1" aria-label="Boards">
              {boards.map((b) => (
                <Link key={b.id} href={`/cx/command/streams?brand=${brand.id}&board=${b.id}`} className={cn("rounded-full border px-3 py-1 text-[12.5px]", b.id === board.id ? "border-brand bg-brand-soft text-brand-ink" : "border-border-strong text-text-2 hover:text-text")}>{b.name}</Link>
              ))}
            </nav>
          )}
          <CommandWall title={board.name} updatedAt={new Date().toISOString()} refreshSec={30} toolbar={<BoardEditor brandId={brand.id} board={{ id: board.id, name: board.name, streams: board.streams }} topics={topicOpts} sources={sourceOpts} compact />}>
            <StreamColumns brandId={brand.id} streams={streams} />
          </CommandWall>
        </>
      )}
    </Page>
  );
}
