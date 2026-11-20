import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro, Prose } from "@/components/site/prose";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: `${SITE.product} is ${SITE.operator}'s platform for search visibility and customer experience: SEO, AI visibility, social listening and a unified inbox.`,
};

const MODULES = [
  { title: "Search and AI visibility", text: "Rank tracking, keyword and content research, technical site audits with a live crawler, backlink analysis, and tracking of how Google's AI Overviews, ChatGPT, Gemini and Perplexity describe the university." },
  { title: "Social listening", text: "Public mentions from news, Reddit, YouTube, Bluesky, Mastodon, app stores and Google reviews, with sentiment, intent and trends for every platform. Mentions in Hindi, Gujarati and other Indian languages are translated before they are scored." },
  { title: "Unified inbox", text: "Comments, direct messages, mentions, reviews and emails from connected channels (such as Facebook, Instagram, LinkedIn and email) arrive in one place, so the team can reply quickly and consistently." },
  { title: "Insights and AI assistant", text: "Dashboards, reports and an AI analyst that answers questions from the platform's own data and the university's reference documents, always showing its sources." },
];

export default function AboutPage() {
  return (
    <>
      <PageIntro
        eyebrow="About"
        title={`About ${SITE.product}`}
        lead={<>{SITE.product} is the platform {SITE.operator}&apos;s {SITE.team} uses to understand what people find when they search for the university, and to respond when people talk about it or to it online.</>}
      />
      <Prose>
        <h2>Why it exists</h2>
        <p>
          Prospective students and parents now research a university across search engines, AI assistants, news sites, forums and social networks. Two questions matter most:
          what do they find when they look us up, and are we listening and answering when they talk to us? This platform brings both into one workspace.
        </p>

        <h2>What it does</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {MODULES.map((m) => (
            <div key={m.title} className="rounded-lg border border-border bg-surface p-4 shadow-card">
              <h3 className="!mt-0">{m.title}</h3>
              <p className="!mt-1 text-[13.5px]">{m.text}</p>
            </div>
          ))}
        </div>

        <h2>How we work with data</h2>
        <ul>
          <li><strong>Real numbers only.</strong> Figures come from connected sources. When a source is not connected, the platform shows &ldquo;n/a&rdquo; or labels sample data clearly as demo data; it never presents invented numbers as real.</li>
          <li><strong>Public content and connected accounts.</strong> Listening covers publicly available posts. Messages and comments are only received from accounts that {SITE.operator} owns and has connected.</li>
          <li><strong>Security first.</strong> Access tokens and credentials are encrypted at rest, passwords are stored as salted hashes, and access is limited to authorised staff.</li>
        </ul>
        <p>Read the <Link href="/privacy">Privacy Policy</Link> for the details.</p>

        <h2>Who runs it</h2>
        <p>
          The platform is operated by the {SITE.team} of {SITE.operator}, Vadodara, Gujarat, India, and is used by authorised university staff.
          Accounts are created by invitation or with an official university Google account.
        </p>

        <h2>Get in touch</h2>
        <p>
          Questions, access requests or feedback: see <Link href="/contact">Contact Us</Link> or email <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.
        </p>
      </Prose>
    </>
  );
}
