import { listProjects } from "@/lib/projects";

/** Resolves ?project= for the project-based tools of the local, brand and AI modules. */
export async function projectContext(userId: string, sp: Record<string, string | string[] | undefined>) {
  const projects = await listProjects(userId);
  const requested = typeof sp.project === "string" ? sp.project : null;
  const project = requested ? (projects.find((p) => p.id === requested) ?? null) : null;
  return { projects, project, requested, switcher: projects.map((p) => ({ id: p.id, name: p.name, domain: p.domain })) };
}

export const param = (sp: Record<string, string | string[] | undefined>, key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : undefined);
