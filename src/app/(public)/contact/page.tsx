import { Building2, Globe, KeyRound, Mail, MessageSquare, ShieldCheck, Trash2, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro } from "@/components/site/prose";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact Us",
  description: `Contact ${SITE.operator}'s ${SITE.team} about ${SITE.product}: access, privacy and data deletion requests, technical issues and feedback.`,
};

const TOPICS = [
  { icon: KeyRound, title: "Access and accounts", subject: "Access request", text: "Request an account, reset access or change your role. Include your name, department and the work you need access for." },
  { icon: ShieldCheck, title: "Privacy questions", subject: "Privacy request", text: "Ask what data we hold about you, or ask us to correct it. See the Privacy Policy for your rights." },
  { icon: Trash2, title: "Data deletion", subject: "Data deletion request", text: "Ask us to delete messages, comments or mentions received from Facebook, Instagram, LinkedIn or other platforms. Include your public name or profile link." },
  { icon: Wrench, title: "Technical issues", subject: "Technical issue", text: "Report a problem with the platform. Include the page address, what you did and any error message (never send passwords or tokens)." },
  { icon: MessageSquare, title: "Feedback and ideas", subject: "Feedback", text: "Suggest a feature, report wrong data or tell us what would make your work easier." },
];

export default function ContactPage() {
  const mail = (subject: string) => `mailto:${SITE.email}?subject=${encodeURIComponent(`${SITE.product}: ${subject}`)}`;
  return (
    <>
      <PageIntro
        eyebrow="Contact"
        title="Contact Us"
        lead={<>{SITE.product} is run by {SITE.operator}&apos;s {SITE.team}. Write to us about access, privacy, data deletion, problems or ideas.</>}
      />

      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <a href={mail("Enquiry")} className="group flex gap-4 rounded-lg border border-border bg-surface p-5 shadow-card hover:border-brand">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><Mail className="h-5 w-5" /></span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-text-3">Email</span>
            <span className="block text-[17px] font-semibold break-all text-text group-hover:text-link">{SITE.email}</span>
            <span className="mt-1 block text-[13px] text-text-2">The fastest way to reach the team. Please don&apos;t send passwords or access tokens by email.</span>
          </span>
        </a>
        <div className="flex gap-4 rounded-lg border border-border bg-surface p-5 shadow-card">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-text-2"><Building2 className="h-5 w-5" /></span>
          <address className="min-w-0 text-[14px] leading-relaxed text-text not-italic">
            <span className="block text-[13px] font-medium text-text-3">Postal address</span>
            {SITE.address.map((l) => <span key={l} className="block">{l}</span>)}
          </address>
        </div>
      </div>

      <h2 className="mt-10 mb-3 text-[19px] font-semibold tracking-tight text-text">What can we help with?</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {TOPICS.map((t) => (
          <div key={t.title} className="flex flex-col rounded-lg border border-border bg-surface p-4 shadow-card">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-text"><t.icon className="h-4 w-4 text-brand" />{t.title}</div>
            <p className="mt-1.5 flex-1 text-[13.5px] leading-relaxed text-text-2">{t.text}</p>
            <a href={mail(t.subject)} className="mt-3 text-[13px] font-medium text-link hover:underline">Email about {t.title.toLowerCase()} →</a>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-surface-2 px-5 py-4 text-[13.5px] text-text-2">
        <span className="flex items-center gap-2"><Globe className="h-4 w-4" />University website: <a href={SITE.website} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">{SITE.website.replace(/^https:\/\//, "")}</a></span>
        <span>For admissions and general enquiries, please use the contacts on the university website.</span>
      </div>
      <p className="mt-4 text-[13px] text-text-3">
        How we handle your information: <Link href="/privacy" className="text-link hover:underline">Privacy Policy</Link> · About the platform: <Link href="/about" className="text-link hover:underline">About</Link>
      </p>
    </>
  );
}
