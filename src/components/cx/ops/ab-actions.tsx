"use client";

import { Flag, Play, Square, Trash2, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { declareWinnerAction, deleteAbTestAction, endAbTestAction, startAbTestAction } from "@/app/(app)/cx/ab-testing/actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, Menu, MenuItem } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";

type Props = {
  brandId: string;
  id: string;
  status: "draft" | "running" | "completed";
  winner: "a" | "b" | "none" | null;
  significant: boolean;
  leader: "a" | "b" | null;
  reason: string;
  requireApproval: boolean;
  canAuthor: boolean;
};

export function AbDetailActions(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "start" | "decide">(null);
  const [mode, setMode] = useState<"publish" | "schedule">("publish");
  const [at, setAt] = useState("");
  const [noneOk, setNoneOk] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  if (!p.canAuthor) return null;

  const act = (fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, after?: (data: unknown) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      setError(null);
      setDialog(null);
      after?.(r.data);
      router.refresh();
    });
  const decided = p.winner != null;

  return (
    <>
      {p.status === "draft" && (
        <Button variant="primary" onClick={() => { setError(null); setDialog("start"); }}>
          <Play className="h-4 w-4" /> Start test
        </Button>
      )}
      {p.status !== "draft" && !decided && (
        <Button variant={p.significant ? "primary" : "secondary"} onClick={() => { setError(null); setNoneOk(false); setDialog("decide"); }}>
          <Trophy className="h-4 w-4" /> Declare winner
        </Button>
      )}
      <Menu
        align="right"
        trigger={() => (
          <Button variant="secondary" aria-label="More actions">
            More
          </Button>
        )}
      >
        {(close) => (
          <>
            {p.status === "running" && (
              <MenuItem
                icon={<Square className="h-3.5 w-3.5" />}
                onClick={async () => {
                  close();
                  if (await confirm({ title: "End the test now?", description: "Clicks after this moment are no longer counted. You can still declare the winner afterwards.", tone: "primary", confirmLabel: "End test" })) act(() => endAbTestAction(p.brandId, p.id));
                }}
              >
                End test
              </MenuItem>
            )}
            <MenuItem
              danger
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={async () => {
                close();
                if (await confirm({ title: "Delete this A/B test?", description: "Its two posts and their tracked links stay in Publishing." })) act(() => deleteAbTestAction(p.brandId, p.id), () => router.push(`/cx/ab-testing?brand=${p.brandId}`));
              }}
            >
              Delete test
            </MenuItem>
          </>
        )}
      </Menu>
      {error && !dialog && <Callout tone="critical" className="basis-full">{error}</Callout>}
      {info && <Callout tone="info" className="basis-full">{info}</Callout>}

      <Dialog
        open={dialog === "start"}
        onClose={() => setDialog(null)}
        title="Start the test"
        description="Both variant posts go out at the same time on every channel of the test."
        error={dialog === "start" ? error : null}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={pending}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                act(() => startAbTestAction(p.brandId, p.id, mode, mode === "schedule" && at ? new Date(at).toISOString() : null), (d) => {
                  if ((d as { pendingApproval: boolean }).pendingApproval) setInfo("Both variants were submitted for approval. The test starts when both are approved and published.");
                })
              }
            >
              {p.requireApproval ? "Submit / start" : mode === "schedule" ? "Schedule both" : "Publish both now"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Segmented<"publish" | "schedule"> value={mode} onChange={setMode} options={[{ value: "publish", label: "Publish now" }, { value: "schedule", label: "Schedule at" }]} />
          {mode === "schedule" && <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Publish both variants at" />}
          {p.requireApproval && (
            <Callout tone="warning">This brand requires approval. Drafts are submitted for approval; already approved posts are {mode === "schedule" ? "scheduled" : "published"} now.</Callout>
          )}
        </div>
      </Dialog>

      <Dialog
        open={dialog === "decide"}
        onClose={() => setDialog(null)}
        title="Declare the winner"
        description="Declaring ends the test: clicks after now are no longer counted."
        error={dialog === "decide" ? error : null}
        footerStart={
          <Button variant="secondary" disabled={!noneOk || pending} onClick={() => act(() => declareWinnerAction(p.brandId, p.id, "none"))}>
            <Flag className="h-4 w-4" /> No winner
          </Button>
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={pending}>Cancel</Button>
            <Button variant="primary" disabled={!p.significant || pending} loading={pending} onClick={() => act(() => declareWinnerAction(p.brandId, p.id, "winner"))}>
              <Trophy className="h-4 w-4" /> {p.significant && p.leader ? `Variant ${p.leader.toUpperCase()} wins` : "No significant winner"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 text-[13px]">
          <Callout tone={p.significant ? "good" : "info"}>{p.reason}</Callout>
          {!p.significant && <p className="text-text-2">A winner can only be declared when both variants reached the minimum clicks and the difference is significant at the test&apos;s confidence level. You can end the test without a winner instead.</p>}
          <label className="flex items-start gap-2 text-text-2">
            <Checkbox checked={noneOk} onChange={(e) => setNoneOk(e.target.checked)} className="mt-0.5" />
            <span>I want to close this test with <b>no winner</b>.</span>
          </label>
        </div>
      </Dialog>
      {confirmDialog}
    </>
  );
}
