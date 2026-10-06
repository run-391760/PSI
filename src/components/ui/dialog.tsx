"use client";

import { X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SubmitEvent as ReactSubmitEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Callout } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

/* Page scroll lock, ref-counted so stacked dialogs restore the page only when the last one closes. */
let scrollLocks = 0;
let savedScroll: { overflow: string; paddingRight: string } | null = null;
function lockScroll() {
  if (scrollLocks++ > 0) return;
  const html = document.documentElement;
  const gutter = window.innerWidth - html.clientWidth;
  savedScroll = { overflow: html.style.overflow, paddingRight: html.style.paddingRight };
  html.style.overflow = "hidden";
  if (gutter > 0) html.style.paddingRight = `${gutter}px`;
}
function unlockScroll() {
  if (--scrollLocks > 0) return;
  scrollLocks = 0;
  const html = document.documentElement;
  html.style.overflow = savedScroll?.overflow ?? "";
  html.style.paddingRight = savedScroll?.paddingRight ?? "";
  savedScroll = null;
}

/** Text-entry controls that take initial focus (checkboxes, radios and buttons are skipped). */
const FIELD =
  "[autofocus], [data-autofocus], input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]):not([type=range]):not([type=color]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled])";
function firstField(root: HTMLElement | null) {
  if (!root) return null;
  return [...root.querySelectorAll<HTMLElement>(FIELD)].find((el) => el.getClientRects().length > 0) ?? null;
}

const WIDTHS = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  full: "sm:max-w-[min(1200px,calc(100%-2rem))]",
};

/**
 * Modal built on the native <dialog> (top layer, focus trap, focus restore). Below 640px it is a
 * bottom sheet. Only the body scrolls; header, error callout and footer stay pinned.
 *
 * - `footerStart` holds destructive/secondary actions on the left; `footer` holds Cancel + primary.
 * - `onSubmit` wraps body + footer in a <form noValidate>: Enter submits, as do footer buttons with
 *   type="submit". Untyped buttons (e.g. Cancel) never submit. A call site that writes the prop keeps
 *   the <form> even while it passes `undefined` (`onSubmit={done ? undefined : save}`), so the body
 *   doesn't remount; don't nest another <form> in such a dialog's body.
 * - `dismissible={false}` blocks Esc, backdrop and the X (e.g. while a one-time secret is shown).
 * - Initial focus goes to an autoFocus element, else the first text field in the body.
 */
export function Dialog(props: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  footerStart?: ReactNode;
  error?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  dismissible?: boolean;
  onSubmit?: (e: ReactSubmitEvent<HTMLFormElement>) => void;
  initialFocus?: "first-field" | "none";
}) {
  const {
    open,
    onClose,
    title,
    description,
    children,
    footer,
    footerStart,
    error,
    size = "md",
    dismissible = true,
    onSubmit,
    initialFocus = "first-field",
  } = props;
  // Keyed on the prop being written, not its value, so toggling it to undefined keeps the tree stable.
  const asForm = "onSubmit" in props;
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const downOnBackdrop = useRef(false);
  const cancelAt = useRef(0);
  // Content mounts only once the <dialog> is shown, so React's autoFocus lands on a visible element.
  const [shown, setShown] = useState(false);
  const titleId = useId();
  const descId = useId();

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      if (!d.open) d.showModal();
      setShown(true);
      lockScroll();
      return unlockScroll;
    }
    if (d.open) d.close();
    setShown(false);
  }, [open]);

  useLayoutEffect(() => {
    const d = ref.current;
    if (!shown || !d) return;
    const active = document.activeElement;
    if (active && active !== d && active !== closeRef.current && d.contains(active)) return; // autoFocus won
    (initialFocus === "first-field" ? (firstField(bodyRef.current) ?? d) : d).focus();
  }, [shown, initialFocus]);

  const requestClose = () => {
    if (dismissible) onClose();
  };

  // Click-outside: both the press and the release must land on the backdrop, so a text selection
  // dragged out of an input never closes the dialog.
  const onBackdrop = (e: ReactMouseEvent<HTMLDialogElement>) => {
    const d = ref.current;
    if (!d || e.target !== d) return false;
    const r = d.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault(); // cancels the browser's own close request; we decide
    requestClose();
  };

  const submit = (e: ReactSubmitEvent<HTMLFormElement>) => {
    if (e.target !== e.currentTarget) return; // a form nested in the body handles its own submit
    e.preventDefault();
    e.stopPropagation(); // keep it from reaching an enclosing dialog or page form
    if (!onSubmit) return;
    const by = e.nativeEvent.submitter;
    if (by instanceof HTMLButtonElement && !by.hasAttribute("type")) return; // untyped buttons aren't submit buttons here
    if (by?.hasAttribute("data-dialog-default")) {
      // Enter: respect a disabled/loading primary instead of submitting behind its back.
      const real = [...e.currentTarget.querySelectorAll<HTMLButtonElement | HTMLInputElement>("[type=submit]:not([data-dialog-default])")];
      if (real.length && real.every((b) => b.disabled)) return;
    }
    onSubmit(e);
  };

  const hasBody = children != null && children !== false && children !== "";
  const actions = (footer || footerStart) && (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3">
      {footerStart && <div className="mr-auto flex flex-wrap items-center gap-2">{footerStart}</div>}
      <div className="flex flex-1 flex-wrap items-center justify-end gap-2">{footer}</div>
    </div>
  );
  const content = (
    <>
      {hasBody && (
        <div ref={bodyRef} className="scroll-thin min-h-0 flex-auto overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>
      )}
      {error && (
        <div role="alert" className={cn("shrink-0 px-5 pb-3", !hasBody && "pt-3")}>
          <Callout tone="critical">{error}</Callout>
        </div>
      )}
      {actions}
    </>
  );

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        // Esc that bypassed onKeyDown (e.g. a child stopped propagation) or the Android back gesture.
        e.preventDefault();
        e.stopPropagation(); // React bubbles cancel/close; an enclosing dialog must not close too
        cancelAt.current = performance.now();
        requestClose();
      }}
      onClose={(e) => {
        e.stopPropagation();
        // Our own close() (open already false) is ignored, so onClose fires once per dismissal.
        const d = ref.current;
        if (!open || !d || d.open) return;
        // The browser closed it anyway (a cancel it would not let us prevent): restore it and let the
        // parent decide; skip the request if the cancel handler just made it.
        d.showModal();
        if (performance.now() - cancelAt.current > 500) requestClose();
      }}
      onMouseDown={(e) => (downOnBackdrop.current = onBackdrop(e))}
      onMouseUp={(e) => {
        const close = downOnBackdrop.current && onBackdrop(e);
        downOnBackdrop.current = false;
        if (close) requestClose();
      }}
      className={cn(
        "dialog-panel max-h-none overflow-hidden bg-surface p-0 text-left text-text shadow-modal outline-none",
        // Mobile: bottom sheet.
        "inset-x-0 top-auto bottom-0 m-0 w-full max-w-none rounded-t-2xl border-0 border-t border-border",
        // ≥640px: centred card.
        "sm:inset-0 sm:m-auto sm:w-[calc(100%-2rem)] sm:rounded-xl sm:border",
        WIDTHS[size],
      )}
    >
      {open && shown && (
        <div
          className={cn(
            "flex flex-col max-sm:pb-[env(safe-area-inset-bottom)]",
            size === "full" ? "h-[92dvh] sm:h-[min(92dvh,1100px)]" : "max-h-[90dvh] sm:max-h-[min(85dvh,900px)]",
          )}
        >
          <div className={cn("flex shrink-0 items-start gap-3 px-5 py-4", (hasBody || error) && "border-b border-border")}>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[16px] leading-snug font-semibold break-words">
                {title}
              </h2>
              {description && (
                <div id={descId} className="mt-0.5 text-[13px] break-words text-text-2">
                  {description}
                </div>
              )}
            </div>
            {dismissible && (
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-my-1.5 -mr-2 inline-flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-md text-text-3 hover:bg-surface-3 hover:text-text focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {asForm ? (
            // noValidate: callers validate in their handlers; native bubbles would also fire on untyped buttons.
            <form noValidate onSubmit={submit} className="flex min-h-0 flex-auto flex-col">
              {/* Default button first in tree order, so Enter submits even when Cancel precedes the primary.
                  Disabled while onSubmit is unset, which turns Enter into a no-op. */}
              <button type="submit" data-dialog-default disabled={!onSubmit} tabIndex={-1} aria-hidden className="sr-only" />
              {content}
            </form>
          ) : (
            content
          )}
        </div>
      )}
    </dialog>
  );
}

const FOCUSABLE = "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/**
 * Dropdown menu: click the trigger to open; closes on outside click / Esc (focus returns to the
 * trigger). A trigger without its own button gets role=button + tabIndex so keyboards can open it.
 * Arrow keys move between items.
 */
export function Menu({ trigger, children, align = "left", className }: { trigger: (open: boolean) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  const [ownFocus, setOwnFocus] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);
  const menuId = useId();

  const innerTrigger = () => triggerRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
  const focusTrigger = () => (innerTrigger() ?? triggerRef.current)?.focus();
  const items = () => [...(listRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];

  // Mirror the open state onto a trigger that brings its own button; otherwise the wrapper is the button.
  useEffect(() => {
    const inner = innerTrigger();
    setOwnFocus(!inner);
    if (!inner) return;
    inner.setAttribute("aria-haspopup", "menu");
    inner.setAttribute("aria-expanded", String(open));
    if (open) inner.setAttribute("aria-controls", menuId);
    else inner.removeAttribute("aria-controls");
  });

  useEffect(() => {
    if (!open) return;
    if (focusFirst.current) {
      focusFirst.current = false;
      (items()[0] ?? listRef.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    }
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && open) {
      // Handled here so an enclosing Dialog doesn't also close.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      focusTrigger();
      return;
    }
    const inTrigger = triggerRef.current?.contains(e.target as Node);
    if (inTrigger && ownFocus && e.target === triggerRef.current && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      if (!open) focusFirst.current = true;
      setOpen((o) => !o);
      return;
    }
    if (inTrigger && e.key === "ArrowDown") {
      e.preventDefault();
      focusFirst.current = true;
      if (open) items()[0]?.focus();
      else setOpen(true);
      return;
    }
    if (!open || !listRef.current?.contains(e.target as Node)) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return; // filter menus with fields keep their keys
    const list = items();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    list[(next + list.length) % list.length]?.focus();
  };

  return (
    <div
      ref={ref}
      className="relative inline-block"
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // Tabbing out closes; a click on non-focusable menu chrome (relatedTarget null) does not.
        if (open && e.relatedTarget && !ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <span
        ref={triggerRef}
        role={ownFocus ? "button" : undefined}
        tabIndex={ownFocus ? 0 : undefined}
        aria-haspopup={ownFocus ? "menu" : undefined}
        aria-expanded={ownFocus ? open : undefined}
        aria-controls={ownFocus && open ? menuId : undefined}
        onClick={(e) => {
          if (!open && e.detail === 0) focusFirst.current = true; // keyboard-activated button
          setOpen((o) => !o);
        }}
        className="block rounded-md focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
      >
        {trigger(open)}
      </span>
      {open && (
        <div ref={listRef} id={menuId} role="menu" className={cn("absolute z-50 mt-1 min-w-48 rounded-lg border border-border bg-surface py-1 shadow-pop", align === "right" ? "right-0" : "left-0", className)}>
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, href, danger, icon }: { children: ReactNode; onClick?: () => void; href?: string; danger?: boolean; icon?: ReactNode }) {
  const cls = cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] outline-none hover:bg-surface-3 focus-visible:bg-surface-3", danger ? "text-critical-ink" : "text-text");
  if (href)
    return (
      <a href={href} role="menuitem" className={cls}>
        {icon}
        {children}
      </a>
    );
  return (
    <button type="button" role="menuitem" onClick={onClick} className={cls}>
      {icon}
      {children}
    </button>
  );
}
