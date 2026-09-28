"use server";

import { deleteAlert, disconnectTelegram, saveAlert, saveSlack, saveTelegram, telegramChats, testAlert, toggleAlert, type AlertRow } from "@/lib/cx/admin/alerts";
import { adminAction } from "@/lib/cx/admin/guard";

const P = "/cx/settings/alerts";
const act = <T,>(brand: string, fn: (u: { id: string; name: string }) => Promise<T>) => adminAction(brand, "page:settings.alerts", P, fn);

export type AlertInput = Omit<AlertRow, "id" | "checked_at" | "last_fired_at" | "fired"> & { id?: string };
export const saveAlertAction = async (brand: string, a: AlertInput) => act(brand, (u) => saveAlert(brand, a, u));
export const deleteAlertAction = async (brand: string, id: string) => act(brand, (u) => deleteAlert(brand, id, u));
export const toggleAlertAction = async (brand: string, id: string, active: boolean) => act(brand, () => toggleAlert(brand, id, active));
export const testAlertAction = async (brand: string, id: string) => act(brand, () => testAlert(brand, id));
export const saveSlackAction = async (brand: string, url: string, channel: string) => act(brand, (u) => saveSlack(brand, url, channel, u));
export const saveTelegramAction = async (brand: string, token: string | null, chatId: string) => act(brand, (u) => saveTelegram(brand, token, chatId, u));
export const disconnectTelegramAction = async (brand: string) => act(brand, (u) => disconnectTelegram(brand, u));
export const telegramChatsAction = async (brand: string) => act(brand, () => telegramChats(brand));
