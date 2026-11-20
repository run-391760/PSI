import Link from "next/link";
import { Logo } from "@/components/shell/logo";
import { SiteFooter } from "@/components/site/footer";
import { buttonClass } from "@/components/ui/button";
import { currentUser } from "@/lib/auth";

/** Public pages (About, Privacy Policy, Contact Us): readable without signing in. */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-5">
          <Link href={user ? "/dashboard" : "/login"} className="flex items-center gap-2" aria-label="SynapseSEO home">
            <Logo size={26} />
            <span className="text-[16px] font-semibold tracking-tight">
              Synapse<span className="text-brand">SEO</span>
            </span>
          </Link>
          <Link href={user ? "/dashboard" : "/login"} className={buttonClass(user ? "secondary" : "primary", "md")}>
            {user ? "Open dashboard" : "Sign in"}
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-10">{children}</main>
      <div className="border-t border-border bg-surface py-5">
        <SiteFooter />
      </div>
    </div>
  );
}
