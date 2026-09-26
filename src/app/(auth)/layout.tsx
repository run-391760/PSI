import { BarChart3, Gauge, Link2, Target } from "lucide-react";
import { Logo } from "@/components/shell/logo";

const points = [
  { icon: Target, title: "Track rankings daily", text: "Visibility, share of voice and SERP features across devices and locations." },
  { icon: Gauge, title: "Audit your site", text: "A real crawler checks 100+ technical issues and Core Web Vitals." },
  { icon: Link2, title: "Understand backlinks", text: "Referring domains, anchors, toxic links and link-building prospects." },
  { icon: BarChart3, title: "Outsmart competitors", text: "Traffic, keywords, gaps and market share for any domain." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2">
            <Logo size={30} />
            <span className="text-[18px] font-semibold tracking-tight">
              Synapse<span className="text-brand">SEO</span>
            </span>
          </div>
          {children}
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-nav lg:flex lg:items-center lg:justify-center">
        <div className="absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full bg-[#5b45e8]/30 blur-3xl" aria-hidden />
        <div className="absolute -bottom-48 -left-24 h-[420px] w-[420px] rounded-full bg-[#2a78d6]/20 blur-3xl" aria-hidden />
        <div className="relative max-w-md px-10">
          <h2 className="text-[28px] leading-tight font-semibold text-white">Everything you need to win search — in one workspace.</h2>
          <ul className="mt-8 space-y-5">
            {points.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[#c7bfff]">
                  <p.icon className="h-4.5 w-4.5" />
                </span>
                <div>
                  <div className="font-medium text-white">{p.title}</div>
                  <div className="text-[13px] text-nav-text">{p.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
