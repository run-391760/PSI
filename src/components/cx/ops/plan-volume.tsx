"use client";

import { useState } from "react";
import { BarChart } from "@/components/charts/bar-chart";
import { Segmented } from "@/components/ui/tabs";

type Row = { month: string; tickets: number; messagesIn: number; messagesOut: number; mentions: number };
type View = "tickets" | "messages" | "mentions";

/** Six-month volume chart with a metric switch (one y-axis per view). */
export function PlanVolume({ data }: { data: Row[] }) {
  const [view, setView] = useState<View>("tickets");
  const series =
    view === "tickets" ? [{ key: "tickets", label: "Tickets created" }]
    : view === "messages" ? [{ key: "messagesIn", label: "Received" }, { key: "messagesOut", label: "Sent" }]
    : [{ key: "mentions", label: "Listening mentions" }];
  return (
    <div>
      <Segmented
        options={[{ value: "tickets", label: "Tickets" }, { value: "messages", label: "Messages" }, { value: "mentions", label: "Mentions" }]}
        value={view}
        onChange={setView}
        className="mb-3"
      />
      <BarChart data={data} xKey="month" xFormat="monthShort" yFormat="number" series={series} stacked={view === "messages"} valueLabels={view !== "messages"} height={220} />
    </div>
  );
}
