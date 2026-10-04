import Link from "next/link";
import { Callout } from "@/components/ui/feedback";
import type { Connection } from "@/lib/cx/publishing/data";

/** Explains what the publishing module needs per network, and the manual path that still measures clicks. */
export function NoConnectionCallout({ conns, brandId, className, kinds }: { conns: Connection[]; brandId: string; className?: string; kinds?: string[] }) {
  const list = conns.filter((c) => (!kinds || kinds.includes(c.kind)) && !c.connected);
  if (!list.length) return null;
  return (
    <Callout tone="info" className={className} title={kinds ? "These channels are not connected for publishing" : "No publishing API is connected on this server"}>
      <p>
        Tests still work: both posts are created and, when they are due, Publishing marks each unconnected channel “not connected”. Post each variant by hand with its own tracked short link (shown on the test page), then use “mark as published” on the post in Publishing. Clicks on the short links are recorded for real, so the comparison works for manual posts too.
      </p>
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[12.5px] text-link">What each network needs</summary>
        <ul className="mt-1.5 grid gap-1.5 text-[12.5px]">
          {list.map((c) => (
            <li key={c.kind} className="min-w-0">
              <span className="font-medium text-text">{c.name}</span> · {c.api}
              {c.costNote && <span className="text-text-3"> · {c.costNote}</span>}
              {c.setup && <div className="text-text-3">{c.setup}</div>}
            </li>
          ))}
        </ul>
        <Link href={`/cx/publishing?brand=${brandId}&tab=settings`} className="mt-1.5 inline-block text-[12.5px] text-link hover:underline">Channels & roles in Publishing →</Link>
      </details>
    </Callout>
  );
}
