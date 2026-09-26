"use client";

import { Download, FileUp, FlaskConical, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { type DragEvent, useRef, useState, useTransition } from "react";
import { loadSampleAction } from "@/app/(app)/log-file-analyzer/actions";
import { cn } from "@/lib/utils";
import { Button, buttonClass } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Bar } from "@/components/ui/progress";

const MAX = 50 * 1024 * 1024;
const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

type State = { phase: "idle" } | { phase: "uploading"; name: string; size: number; pct: number } | { phase: "analyzing"; name: string; size: number } | { phase: "error"; message: string };

/** Drag-and-drop uploader: streams the raw file to the route handler with upload progress. */
export function LogUploader() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ phase: "idle" });
  const [drag, setDrag] = useState(false);
  const [sampling, startSample] = useTransition();
  const busy = state.phase === "uploading" || state.phase === "analyzing";

  const upload = (file: File) => {
    if (!/\.(log|txt|gz|access|out)$/i.test(file.name) && !/^access|log/i.test(file.name)) return setState({ phase: "error", message: "Choose an access log (.log, .txt) or a gzip-compressed log (.gz)." });
    if (file.size > MAX) return setState({ phase: "error", message: `${file.name} is ${fmtSize(file.size)}. The limit is 50 MB — upload a shorter period or compress it with gzip.` });
    if (!file.size) return setState({ phase: "error", message: "The file is empty." });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/content/logs?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && setState({ phase: "uploading", name: file.name, size: file.size, pct: Math.round((e.loaded / e.total) * 100) });
    xhr.upload.onload = () => setState({ phase: "analyzing", name: file.name, size: file.size });
    xhr.onerror = () => setState({ phase: "error", message: "The upload failed (network error). Please try again." });
    xhr.onload = () => {
      let body: { id?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status === 200 && body.id) router.push(`/log-file-analyzer/${body.id}`);
      else setState({ phase: "error", message: body.error ?? `Upload failed (HTTP ${xhr.status}).` });
    };
    setState({ phase: "uploading", name: file.name, size: file.size, pct: 0 });
    xhr.send(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !busy) upload(f);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn("flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors", drag ? "border-brand bg-brand-soft/60" : "border-border-strong bg-surface-2")}
      >
        {busy ? (
          <div className="w-full max-w-md">
            <div className="mb-2 flex items-center justify-between gap-3 text-[13px]">
              <span className="truncate font-medium text-text">{state.name}</span>
              <span className="shrink-0 text-text-3">{fmtSize(state.size)}</span>
            </div>
            <Bar value={state.phase === "uploading" ? state.pct : 100} color="var(--brand)" className="h-2" />
            <p className="mt-2 text-[12.5px] text-text-2">{state.phase === "uploading" ? `Uploading… ${state.pct}%` : "Parsing lines, detecting bots and verifying crawler IPs…"}</p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div className="text-[14px] font-semibold text-text">Drop an access log here</div>
            <p className="mt-1 max-w-md text-[12.5px] text-text-2">Apache or Nginx access log in Combined or Common format, plain or gzip-compressed (.log, .txt, .gz), up to 50 MB.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => input.current?.click()}>
                <FileUp className="h-4 w-4" /> Choose file
              </Button>
              <Button
                loading={sampling}
                onClick={() =>
                  startSample(async () => {
                    const res = await loadSampleAction();
                    if (res.ok) router.push(`/log-file-analyzer/${res.data.id}`);
                    else setState({ phase: "error", message: res.error });
                  })
                }
              >
                {!sampling && <FlaskConical className="h-4 w-4" />} Load sample log
              </Button>
              <a href="/api/content/logs/sample" className={buttonClass("ghost")} download>
                <Download className="h-4 w-4" /> Download sample file
              </a>
            </div>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".log,.txt,.gz,.access,.out,text/plain,application/gzip,application/x-gzip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </div>
      {state.phase === "error" && (
        <Callout tone="critical" className="mt-3" action={<Button size="sm" variant="ghost" onClick={() => setState({ phase: "idle" })}>Dismiss</Button>}>
          {state.message}
        </Callout>
      )}
    </div>
  );
}
