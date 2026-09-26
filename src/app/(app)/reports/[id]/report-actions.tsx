"use client";

import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { duplicateReportAction } from "../actions";

export function DuplicateReportButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await duplicateReportAction(id);
          if (res.ok) router.push(`/reports/${res.data.id}/edit`);
        })
      }
    >
      {!pending && <Copy className="h-4 w-4" />} Duplicate
    </Button>
  );
}
