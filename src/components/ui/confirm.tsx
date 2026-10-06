"use client";

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type ConfirmOptions = {
  title: ReactNode;
  description?: ReactNode;
  /** Defaults to "Delete" for tone danger, else "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /** Type-to-confirm: the confirm button stays disabled until this exact text is typed. */
  requireText?: string;
};

/**
 * Styled replacement for window.confirm. Enter confirms (the confirm button takes focus, or the
 * type-to-confirm field when `requireText` is set). Pass `busy`/`error` when the caller keeps it
 * open while an async action runs; useConfirm() covers the plain yes/no case.
 */
export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  requireText,
  busy,
  error,
}: ConfirmOptions & { open: boolean; onConfirm: () => void; onCancel: () => void; busy?: boolean; error?: ReactNode }) {
  const [typed, setTyped] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTyped("");
  }
  const inputId = useId();
  const ready = !requireText || typed.trim() === requireText.trim();
  const hasBody = description != null || !!requireText;
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      dismissible={!busy}
      error={error}
      onSubmit={() => ready && !busy && onConfirm()}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="submit" variant={tone === "danger" ? "danger" : "primary"} disabled={!ready} loading={busy} autoFocus={!requireText}>
            {confirmLabel ?? (tone === "danger" ? "Delete" : "Confirm")}
          </Button>
        </>
      }
    >
      {hasBody && (
        <div className="space-y-3">
          {description != null && <div className="text-[13px] leading-relaxed break-words text-text-2">{description}</div>}
          {requireText && (
            <div>
              <label htmlFor={inputId} className="mb-1 block text-[12.5px] text-text-2">
                Type <span className="font-semibold break-all text-text">{requireText}</span> to confirm
              </label>
              <Input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus />
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

/**
 * Promise-based confirm. Render {confirmDialog} once, then:
 *   if (!(await confirm({ title: "Delete X?" }))) return;
 */
export function useConfirm() {
  const [state, setState] = useState<{ open: boolean; options: ConfirmOptions }>({ open: false, options: { title: "" } });
  const pending = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    pending.current?.(false); // a newer request supersedes an unanswered one
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setState({ open: true, options });
    });
  }, []);

  const settle = (ok: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setState((s) => ({ ...s, open: false })); // keep the options so the title doesn't blank while closing
    resolve?.(ok);
  };

  useEffect(() => () => pending.current?.(false), []);

  const confirmDialog = <ConfirmDialog open={state.open} {...state.options} onConfirm={() => settle(true)} onCancel={() => settle(false)} />;
  return { confirm, confirmDialog };
}
