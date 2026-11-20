import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro, Prose } from "@/components/site/prose";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${SITE.operator} collects, uses, stores and protects personal data in ${SITE.product}, and how to request access or deletion.`,
};

const SECTIONS = [
  ["who", "Who we are"],
  ["collect", "Information we collect"],
  ["use", "How we use information"],
  ["ai", "AI processing"],
  ["share", "Sharing and service providers"],
  ["security", "Storage and security"],
  ["retention", "How long we keep data"],
  ["cookies", "Cookies and local storage"],
  ["rights", "Your rights"],
  ["deletion", "Data deletion requests"],
  ["children", "Children"],
  ["changes", "Changes to this policy"],
  ["contact", "Contact and grievances"],
] as const;

export default function PrivacyPage() {
  const mail = (subject: string) => `mailto:${SITE.email}?subject=${encodeURIComponent(subject)}`;
  return (
    <>
      <PageIntro
        eyebrow="Legal"
        title="Privacy Policy"
        lead={<>How {SITE.operator} collects, uses and protects personal data in {SITE.product}. Last updated {SITE.policyUpdated}.</>}
      />
      <nav aria-label="On this page" className="mb-2 rounded-lg border border-border bg-surface p-4 shadow-card">
        <div className="mb-2 text-[12px] font-semibold tracking-wider text-text-3 uppercase">On this page</div>
        <ol className="grid list-decimal gap-x-6 gap-y-1 pl-5 text-[13.5px] sm:grid-cols-2">
          {SECTIONS.map(([id, label]) => (
            <li key={id}><a href={`#${id}`} className="text-link hover:underline">{label}</a></li>
          ))}
        </ol>
      </nav>
      <Prose>
        <h2 id="who">1. Who we are</h2>
        <p>
          {SITE.product} (&ldquo;the platform&rdquo;) is operated by {SITE.operator}, P.O. Limda, Ta. Waghodia, Vadodara, Gujarat 391760, India (&ldquo;we&rdquo;, &ldquo;us&rdquo;).
          It is an internal tool used by authorised university staff for search visibility, social listening and responding to people who contact the university online.
          This policy covers the platform and its connected integrations. It does not cover the university&apos;s main website or other services, which have their own policies.
        </p>

        <h2 id="collect">2. Information we collect</h2>
        <h3>Staff accounts</h3>
        <ul>
          <li>Name, email address and a password (stored only as a salted scrypt hash, never in readable form).</li>
          <li>If you use <strong>Sign in with Google</strong>, we receive your name, email address and confirmation that the email is verified. We do not receive your Google password or access to your Google account&apos;s content.</li>
          <li>Settings and work you create in the platform, such as projects, topics, notes, replies, reports and documents uploaded to the knowledge vault.</li>
        </ul>
        <h3>Messages and comments sent to the university&apos;s own accounts</h3>
        <p>When the university connects one of its own accounts, the platform receives what people send or post to that account, so staff can read and reply:</p>
        <ul>
          <li><strong>Facebook and Instagram</strong> (Meta): direct messages, comments, mentions and Page ratings for the university&apos;s Pages and Instagram business accounts, with the sender&apos;s public name, profile ID and any attachments.</li>
          <li><strong>LinkedIn</strong>: comments on the university&apos;s company page posts and posts that mention the page, with the author&apos;s public name and profile ID.</li>
          <li><strong>Email, live chat, web forms and other connected channels</strong>: the messages and the contact details people choose to send.</li>
        </ul>
        <h3>Public content (social listening)</h3>
        <p>
          The platform collects publicly available posts and articles that mention the university or topics it follows, from sources such as Google News, Reddit, YouTube, Bluesky, Mastodon,
          app stores and Google reviews. For each item we store the text, link, publication date, the author&apos;s public name or handle, public engagement counts and, where the source shows it, follower count.
          We do not collect private posts or content behind a login.
        </p>
        <h3>Website and analytics data</h3>
        <p>With read-only permission, the platform shows Google Search Console and Google Analytics reports for university websites. These reports are aggregated and do not identify individual visitors.</p>
        <h3>Technical information</h3>
        <p>
          A session cookie keeps you signed in (see <a href="#cookies">Cookies</a>). The server may record standard request information, such as IP address, time and page requested,
          to keep the service secure and to troubleshoot problems. The platform does not use advertising or third-party analytics trackers.
        </p>

        <h2 id="use">3. How we use information</h2>
        <ul>
          <li>To read, route and reply to messages, comments and reviews sent to the university&apos;s accounts.</li>
          <li>To measure how the university is discussed online: volumes, sentiment, topics and trends, and to spot issues that need a response.</li>
          <li>To improve the university&apos;s search and AI-assistant visibility and the quality of its public information.</li>
          <li>To operate, secure and support the platform, including preventing misuse and enforcing access controls.</li>
          <li>To meet legal obligations.</li>
        </ul>
        <p>We do not sell personal data, use it for advertising, or use it to make decisions about admissions or any individual&apos;s rights.</p>

        <h2 id="ai">4. AI processing</h2>
        <p>Some features use AI models from external providers: Anthropic (Claude), OpenAI, Google (Gemini) and Sarvam AI, used through their business APIs. They are used to:</p>
        <ul>
          <li>Translate Indian-language posts and score sentiment and intent.</li>
          <li>Suggest replies to messages, which staff review before anything is sent.</li>
          <li>Answer staff questions in the AI assistant, using public mentions, the university&apos;s own documents and <strong>aggregated</strong> support statistics. The assistant is not sent the text of private conversations or customers&apos; contact details.</li>
        </ul>
        <p>Only the text needed for the task is sent. The providers process it under their API terms; we do not ask them to use it to train their models.</p>

        <h2 id="share">5. Sharing and service providers</h2>
        <p>We share personal data only as needed to run the platform:</p>
        <ul>
          <li><strong>Hosting:</strong> Google Cloud (servers in the Mumbai region, India).</li>
          <li><strong>Platform APIs:</strong> Meta, LinkedIn, Google and the other networks you interact with, so that replies can be posted and content can be received.</li>
          <li><strong>AI providers</strong> listed above, for the tasks described.</li>
          <li><strong>Search data providers</strong> (such as DataForSEO), which receive search keywords and website addresses, not personal data.</li>
          <li><strong>Authorities</strong>, when required by law or to protect the rights and safety of people and the university.</li>
        </ul>
        <p>Some providers may process data outside India, under their contractual and security commitments.</p>

        <h2 id="security">6. Storage and security</h2>
        <ul>
          <li>All traffic uses HTTPS.</li>
          <li>Access tokens, mailbox passwords and other credentials are encrypted at rest with AES-256-GCM.</li>
          <li>Passwords are stored as salted scrypt hashes; session tokens are stored only as hashes.</li>
          <li>Sign-in attempts are rate-limited, and staff see only the brands and features their role allows.</li>
        </ul>
        <p>No system is perfectly secure. If we learn of a breach that affects your personal data, we will notify you and the authorities as the law requires.</p>

        <h2 id="retention">7. How long we keep data</h2>
        <table>
          <thead><tr><th>Data</th><th>Kept</th></tr></thead>
          <tbody>
            <tr><td>Staff accounts and their work</td><td>While the account is active; deleted on request or when access ends.</td></tr>
            <tr><td>Sign-in sessions</td><td>Up to 30 days, or until you sign out.</td></tr>
            <tr><td>Messages, comments and tickets</td><td>While needed to handle the conversation and keep a record of the university&apos;s responses; deleted on a valid request or when the channel&apos;s workspace is deleted.</td></tr>
            <tr><td>Public mentions (listening)</td><td>While needed for reporting and trend analysis; removed on a valid request.</td></tr>
            <tr><td>Connected-account access tokens</td><td>Until the channel is disconnected, then deleted.</td></tr>
          </tbody>
        </table>

        <h2 id="cookies">8. Cookies and local storage</h2>
        <table>
          <thead><tr><th>Name</th><th>Purpose</th><th>Duration</th></tr></thead>
          <tbody>
            <tr><td><code>synapse_session</code></td><td>Keeps you signed in (essential).</td><td>30 days</td></tr>
            <tr><td><code>synapse_google_signin</code></td><td>Protects Sign in with Google against forgery (essential).</td><td>10 minutes</td></tr>
            <tr><td><code>synapse.theme</code> (local storage)</td><td>Remembers light or dark mode.</td><td>Until cleared</td></tr>
          </tbody>
        </table>
        <p>We do not use advertising, cross-site tracking or third-party analytics cookies.</p>

        <h2 id="rights">9. Your rights</h2>
        <p>Under India&apos;s Digital Personal Data Protection Act, 2023 and other applicable laws, you can ask us to:</p>
        <ul>
          <li>Tell you what personal data we hold about you and how it is used.</li>
          <li>Correct or update inaccurate data.</li>
          <li>Delete your data, where we are not required to keep it.</li>
          <li>Withdraw consent where processing relies on it, for example by disconnecting an account.</li>
          <li>Hear a grievance, and nominate someone to exercise these rights for you.</li>
        </ul>
        <p>Email <a href={mail("Privacy request")}>{SITE.email}</a>. We may ask you to confirm your identity before acting on a request.</p>

        <h2 id="deletion">10. Data deletion requests</h2>
        <p>To delete data the platform holds about you, including data received through Facebook, Instagram or LinkedIn:</p>
        <ol>
          <li>Email <a href={mail("Data deletion request")}>{SITE.email}</a> with the subject <strong>&ldquo;Data deletion request&rdquo;</strong>.</li>
          <li>Include the platform and your public name or profile link (for example, your Instagram handle), and optionally links to the messages or comments concerned.</li>
          <li>We confirm receipt, delete the matching messages, comments, contact records and mentions from the platform, and tell you when it is done, normally within 30 days.</li>
        </ol>
        <p>
          You can also remove the university&apos;s app from your own Facebook settings (Settings &amp; privacy → Settings → Apps and websites). Deleting data from the platform does not delete
          posts you published on a social network; delete those on that network.
        </p>

        <h2 id="children">11. Children</h2>
        <p>
          The platform is for authorised university staff and is not directed at children. If someone under 18 contacts a university account or mentions the university publicly,
          their message may be processed as described above. A parent or guardian can ask us to delete it.
        </p>

        <h2 id="changes">12. Changes to this policy</h2>
        <p>We may update this policy as the platform or the law changes. The date at the top shows the latest version; significant changes are announced to staff users.</p>

        <h2 id="contact">13. Contact and grievances</h2>
        <p>
          For privacy questions, requests or complaints, contact the {SITE.team}: <a href={mail("Privacy question")}>{SITE.email}</a>, {SITE.address.join(", ")}.
          See also <Link href="/contact">Contact Us</Link>.
        </p>
      </Prose>
    </>
  );
}
