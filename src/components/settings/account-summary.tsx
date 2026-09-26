import { BarChart3, FolderKanban } from "lucide-react";
import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";

/** Account card on the Profile tab. */
export function AccountSummary({ name, email, since, projects, reports }: { name: string; email: string; since: string; projects: number; reports: number }) {
  return (
    <Card className="h-fit">
      <CardBody className="pt-4">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand text-[18px] font-semibold text-white uppercase">{(name || email)[0]}</span>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-text">{name || "Your account"}</div>
            <div className="truncate text-[12.5px] text-text-3">{email}</div>
          </div>
        </div>
        <dl className="mt-4 space-y-2 border-t border-border pt-3 text-[12.5px]">
          <div className="flex justify-between">
            <dt className="text-text-3">Member since</dt>
            <dd className="text-text">{since}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-3">Projects</dt>
            <dd>
              <Link href="/projects" className="inline-flex items-center gap-1 text-link hover:underline">
                <FolderKanban className="h-3.5 w-3.5" /> {projects}
              </Link>
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-3">Saved reports</dt>
            <dd>
              <Link href="/reports" className="inline-flex items-center gap-1 text-link hover:underline">
                <BarChart3 className="h-3.5 w-3.5" /> {reports}
              </Link>
            </dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}
