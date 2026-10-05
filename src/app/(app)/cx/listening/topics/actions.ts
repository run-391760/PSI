"use server";

import { enqueue, latestJob, setSchedule } from "@/lib/jobs/queue";
import { settingsAction } from "@/lib/cx/admin/settings-guard";
import { deleteTopic, duplicateTopic, saveTopic, setTopicActive, type TopicInput } from "@/lib/cx/listening/data";

/** Topic editor (/cx/listening/topics) and Settings → Topics actions. */
const FETCH = "cx.listening.fetch";
const PATHS = ["/cx/listening/topics", "/cx/settings/topics", "/cx/listening", "/cx/settings/clusters"];

async function startFetch(ownerId: string, projectId: string) {
  const running = await latestJob(projectId, FETCH);
  if (running && ["queued", "running"].includes(running.status)) return running.id;
  return (await enqueue({ kind: FETCH, ownerId, projectId, payload: { manual: true } })).id;
}

export const saveTopicEditorAction = async (brand: string, input: TopicInput, id?: string) =>
  settingsAction(brand, "page:listening", PATHS, async (user) => {
    const topicId = await saveTopic(brand, input, id, user.id);
    let jobId: string | null = null;
    if (!id) {
      await setSchedule(brand, FETCH, { cadence: "hourly" });
      if (input.active !== false) jobId = await startFetch(user.id, brand);
    }
    return { id: topicId, jobId };
  });

export const duplicateTopicEditorAction = async (brand: string, id: string) =>
  settingsAction(brand, "page:listening", PATHS, async (user) => duplicateTopic(brand, id, user.id));

export const deleteTopicEditorAction = async (brand: string, id: string) =>
  settingsAction(brand, "page:listening", PATHS, async () => {
    await deleteTopic(brand, id);
    return null;
  });

export const setTopicActiveAction = async (brand: string, id: string, active: boolean) =>
  settingsAction(brand, "page:listening", PATHS, async () => {
    await setTopicActive(brand, id, active);
    return null;
  });

export const fetchTopicsNowAction = async (brand: string) =>
  settingsAction(brand, "page:listening", [], async (user) => ({ jobId: await startFetch(user.id, brand) }));
