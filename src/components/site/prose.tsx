import type { ReactNode } from "react";

/** Long-form text styling for public pages (headings, paragraphs, lists, tables, links). */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="text-[14.5px] leading-relaxed text-text-2 [&_a]:text-link [&_a]:underline-offset-2 [&_a:hover]:underline [&_h2]:mt-9 [&_h2]:mb-3 [&_h2]:text-[19px] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-text [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-[15.5px] [&_h3]:font-semibold [&_h3]:text-text [&_li]:mt-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-3 [&_strong]:font-semibold [&_strong]:text-text [&_table]:mt-3 [&_table]:w-full [&_table]:text-[13.5px] [&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:border-b [&_th]:border-border-strong [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-text [&_ul]:list-disc [&_ul]:pl-5">
      {children}
    </div>
  );
}

export function PageIntro({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: ReactNode }) {
  return (
    <div className="mb-8 border-b border-border pb-7">
      <div className="text-[12px] font-semibold tracking-wider text-brand uppercase">{eyebrow}</div>
      <h1 className="mt-2 text-[30px] leading-tight font-semibold tracking-tight text-text">{title}</h1>
      <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-text-2">{lead}</p>
    </div>
  );
}
