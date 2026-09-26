import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import type { JobHandler } from "@/lib/jobs/types";
import { notify } from "@/lib/jobs/queue";
import { findProject } from "@/lib/projects";
import { localCompetitors } from "./competitors";
import { buildListings, distributionTargets, listingRows, writeListing } from "./listings";
import { simulateRow, summarize, type GridCell } from "./map-rank";
import { businessLocation, getProfile } from "./profile";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Background job handlers owned by the local module, keyed by job kind (prefix kinds with "local."). */
export const jobs: Record<string, JobHandler> = {
  /** Push the business profile to directories (demo: updates stored listing snapshots). */
  "local.distribute": async (job, ctx) => {
    const project = await findProject(job.owner_id ?? "", job.project_id);
    if (!project) throw new Error("Project not found.");
    const stored = await getProfile(project.id);
    if (!stored) throw new Error("Save a business profile before distributing updates.");
    const view = buildListings(project, stored.profile, await listingRows(project.id));
    const only = Array.isArray(job.payload.directories) ? (job.payload.directories as string[]) : undefined;
    const targets = distributionTargets(view, only);
    let done = 0;
    const created: string[] = [];
    let suppressed = 0;
    await ctx.progress(0, targets.length, "Preparing listing data");
    for (const row of targets) {
      if (await ctx.cancelled()) return { cancelled: true, updated: done };
      await ctx.progress(done, targets.length, `Updating ${row.name}`);
      await sleep(450 + (row.id.length % 4) * 120);
      await writeListing(project.id, row, stored.profile);
      if (row.status === "not_listed") created.push(row.name);
      suppressed += row.duplicates;
      done++;
    }
    await ctx.progress(done, targets.length, "Done");
    if (targets.length)
      await notify({
        ownerId: project.owner_id,
        projectId: project.id,
        tool: "local",
        severity: "success",
        title: `Listings updated on ${done} director${done === 1 ? "y" : "ies"}`,
        body: `${created.length ? `${created.length} new listing${created.length === 1 ? "" : "s"} submitted. ` : ""}${suppressed ? `${suppressed} duplicate${suppressed === 1 ? "" : "s"} suppressed. ` : ""}Demo data: no directory APIs are connected.`,
        link: `/local/listings?project=${project.id}`,
      });
    return { updated: done, created: created.length, suppressed };
  },

  /** Geo-grid local pack scan (demo simulation). */
  "local.map-scan": async (job, ctx) => {
    let scanId = String(job.payload.scanId ?? "");
    if (!scanId && job.project_id && Array.isArray(job.payload.keywords)) {
      // Scheduled rescan: the schedule payload carries the scan settings.
      const project = await findProject(job.owner_id ?? "", job.project_id);
      const stored = project && (await getProfile(project.id));
      if (!project || !stored) throw new Error("The business profile is missing.");
      const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM local_scans WHERE project_id=$1", [project.id]);
      scanId = randomUUID();
      await query(`INSERT INTO local_scans(id,project_id,keywords,grid_size,radius_km,center,seq,status,job_id) VALUES($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7,'queued',$8)`, [
        scanId,
        project.id,
        JSON.stringify(job.payload.keywords),
        Number(job.payload.grid) || 5,
        Number(job.payload.radiusKm) || 3,
        JSON.stringify(businessLocation(stored.profile, project.country)),
        n + 1,
        job.id,
      ]);
    }
    const [scan] = await query<{ id: string; project_id: string; keywords: string[]; grid_size: number; radius_km: number; center: { lat: number; lng: number; approximate: boolean; basis: string }; seq: number }>(
      "SELECT id,project_id,keywords,grid_size,radius_km,center,seq FROM local_scans WHERE id=$1",
      [scanId],
    );
    if (!scan) throw new Error("Scan not found.");
    try {
      const project = await findProject(job.owner_id ?? "", scan.project_id);
      const stored = project && (await getProfile(project.id));
      if (!project || !stored) throw new Error("The business profile is missing.");
      await query("UPDATE local_scans SET status='running' WHERE id=$1", [scan.id]);
      const businesses = localCompetitors(project, stored.profile);
      const grid = scan.grid_size;
      const total = scan.keywords.length * grid * grid;
      let done = 0;
      for (const keyword of scan.keywords) {
        const cells: (GridCell & { order: string[] })[] = [];
        for (let row = 0; row < grid; row++) {
          if (await ctx.cancelled()) {
            await query("UPDATE local_scans SET status='cancelled', finished_at=now() WHERE id=$1", [scan.id]);
            return { cancelled: true };
          }
          cells.push(...simulateRow({ domain: project.domain, businesses, center: scan.center, keyword, grid, radiusKm: Number(scan.radius_km), seq: scan.seq, row }));
          done += grid;
          await ctx.progress(done, total, `“${keyword}” · checking grid row ${row + 1} of ${grid}`);
          await sleep(Math.max(60, 700 / grid));
        }
        const { metrics, competitors } = summarize(cells, businesses);
        await query(
          `INSERT INTO local_scan_results(scan_id,keyword,cells,metrics,competitors) VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)
           ON CONFLICT(scan_id,keyword) DO UPDATE SET cells=excluded.cells, metrics=excluded.metrics, competitors=excluded.competitors`,
          [scan.id, keyword, JSON.stringify(cells.map(({ order: _order, ...c }) => c)), JSON.stringify(metrics), JSON.stringify(competitors)],
        );
      }
      await query("UPDATE local_scans SET status='done', finished_at=now() WHERE id=$1", [scan.id]);
      return { keywords: scan.keywords.length, points: total };
    } catch (e) {
      await query("UPDATE local_scans SET status='failed', error=$2, finished_at=now() WHERE id=$1", [scan.id, e instanceof Error ? e.message : String(e)]);
      throw e;
    }
  },
};
