import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Bar } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

const PROVIDERS = [
  { name: "Amazon S3", env: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "CX_ASSETS_S3_BUCKET"], note: "Pick files from a bucket; paid per GB by AWS." },
  { name: "Google Drive", env: ["GOOGLE_CLIENT_ID", "GOOGLE_PICKER_API_KEY"], note: "Google Picker; free with a Google Cloud project." },
  { name: "OneDrive", env: ["ONEDRIVE_CLIENT_ID"], note: "OneDrive file picker; free with a Microsoft Entra app." },
];

const fmt = (b: number) => (b >= 1_073_741_824 ? `${(b / 1_073_741_824).toFixed(2)} GB` : `${(b / 1_048_576).toFixed(1)} MB`);

/** Storage quota bar + external storage connect cards (pickers need provider credentials). */
export function StorageCard({ usedBytes, quotaMb, files, brandId, isOwner }: { usedBytes: number; quotaMb: number; files: number; brandId: string; isOwner: boolean }) {
  const quota = quotaMb * 1_048_576;
  const share = quota ? usedBytes / quota : 0;
  return (
    <Card className="mb-4">
      <CardHeader
        title="Storage"
        description={`${fmt(usedBytes)} of ${fmt(quota)} used · ${files} file${files === 1 ? "" : "s"}`}
        actions={isOwner ? <Link href={`/cx/publishing?brand=${brandId}&tab=settings`} className="text-[12.5px] text-link hover:underline">Change quota</Link> : undefined}
      />
      <CardBody className="grid gap-3">
        <div className="grid gap-1">
          <Bar value={Math.min(100, share * 100)} color={share > 0.9 ? "var(--critical)" : share > 0.75 ? "var(--warning)" : "var(--series-1)"} />
          <span className="text-[12px] text-text-3">{Math.round(share * 100)}% used{share > 0.9 ? " — uploads stop when the quota is reached" : ""}</span>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-3">
          {PROVIDERS.map((p) => {
            const ready = p.env.every((e) => !!process.env[e]);
            return (
              <div key={p.name} className="min-w-0 rounded-md border border-border p-2.5 text-[12.5px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge tone={ready ? "good" : "neutral"}>{ready ? "Configured" : "Not connected"}</Badge>
                </div>
                <p className="mt-1 text-text-3">{ready ? "Picker import is not enabled in this build yet; download from the provider and upload here." : p.note}</p>
                {!ready && <p className="mt-1 text-text-3">Server settings: {p.env.map((e) => <code key={e} className="mx-0.5 rounded bg-surface-3 px-1 text-[11px] break-all">{e}</code>)}</p>}
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
