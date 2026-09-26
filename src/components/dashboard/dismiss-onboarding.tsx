"use client";

import { EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setOnboardingHiddenAction } from "@/app/(app)/dashboard/actions";
import { Button } from "@/components/ui/button";

export function DismissOnboarding({ show }: { show?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={pending}
      onClick={() =>
        start(async () => {
          await setOnboardingHiddenAction(!show);
          router.refresh();
        })
      }
    >
      {!show && <EyeOff className="h-3.5 w-3.5" />}
      {show ? "Show setup checklist" : "Hide"}
    </Button>
  );
}
