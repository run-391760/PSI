import { jobHandlers } from "@/lib/jobs/http";

export const dynamic = "force-dynamic";

export const { GET, DELETE } = jobHandlers("local.", { includeResult: true });
