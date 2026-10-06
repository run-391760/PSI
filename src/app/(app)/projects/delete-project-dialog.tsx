"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/confirm";
import { deleteProjectAction } from "./actions";

/** Confirm-by-typing dialog for deleting a project and all of its tool data. */
export function DeleteProjectDialog({
  project,
  open,
  onClose,
  redirectTo,
}: {
  project: { id: string; name: string; domain: string } | null;
  open: boolean;
  onClose: () => void;
  /** Where to go after deletion (defaults to refreshing the current page). */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const close = () => {
    setError(null);
    onClose();
  };
  const remove = () =>
    project &&
    start(async () => {
      const res = await deleteProjectAction(project.id);
      if (!res.ok) return setError(res.error);
      close();
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    });
  return (
    <ConfirmDialog
      open={open && !!project}
      onCancel={close}
      onConfirm={remove}
      title="Delete project?"
      description={
        <>
          <span className="font-medium text-text">
            {project?.name} ({project?.domain})
          </span>
          <br />
          This permanently deletes the project with its audits, tracked keywords, schedules, reports and history. This cannot be undone.
        </>
      }
      confirmLabel="Delete project"
      requireText={project?.domain ?? ""}
      busy={pending}
      error={error}
    />
  );
}
