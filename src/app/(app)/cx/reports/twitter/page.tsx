import type { Metadata } from "next";
import { NetworkReport } from "@/components/cx/reports/network-report";

export const metadata: Metadata = { title: "Twitter Report" };

export default function TwitterReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <NetworkReport network="twitter" searchParams={searchParams} />;
}
