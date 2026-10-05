import type { Metadata } from "next";
import { NetworkReport } from "@/components/cx/reports/network-report";

export const metadata: Metadata = { title: "Instagram Report" };

export default function InstagramReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <NetworkReport network="instagram" searchParams={searchParams} />;
}
