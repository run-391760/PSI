import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
      <div className="text-[40px] font-semibold text-text-3">404</div>
      <p className="text-text-2">This page does not exist.</p>
      <Link href="/dashboard" className="text-link hover:underline">
        Go to dashboard
      </Link>
    </div>
  );
}
