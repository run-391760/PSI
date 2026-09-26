import { Skeleton } from "@/components/ui/feedback";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-5">
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="mb-6 h-7 w-72" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="mt-4 h-72" />
    </div>
  );
}
