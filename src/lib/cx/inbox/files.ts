import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { getCxBrand } from "@/lib/cx/context";
import type { Attachment } from "./store";

/**
 * Ticket attachments (outbound replies, notes, assignments, escalations and stored inbound email files).
 * Bytes live under the data dir next to the database (`.data/inbox-files/<brand>/<id>.<ext>`), like
 * publishing assets; they are served only through authenticated routes (agents) or an unguessable
 * token for files an agent sent into a live chat.
 */
export function filesRoot() {
  const db = process.env.PGLITE_PATH || path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "postgres");
  return path.join(path.dirname(path.resolve(db)), "inbox-files");
}
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/heic": "heic",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/wav": "wav", "audio/webm": "weba", "audio/mp4": "m4a",
  "application/pdf": "pdf", "text/plain": "txt", "text/csv": "csv",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-powerpoint": "ppt", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip", "message/rfc822": "eml",
};
const BY_EXT = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
/** Normalized MIME type for an upload (falls back to the extension when the browser sends none). */
export function mimeFor(name: string, type: string) {
  if (type && EXT[type]) return type;
  const e = name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXT[e === "jpeg" ? "jpg" : e] ?? null;
}
export const ACCEPT = Object.keys(EXT).join(",");
const fileUrl = (id: string) => `/api/cx/inbox/files/${id}`;
export type FileRow = { id: string; project_id: string; ticket_id: string | null; filename: string; mime: string; size: number; file: string; public_token: string; created_at: string };

export async function saveFile(projectId: string, userId: string | null, ticketId: string | null, f: { name: string; type: string; bytes: Buffer }, opts: { lenient?: boolean } = {}): Promise<Attachment> {
  const mime = mimeFor(f.name, f.type) ?? (opts.lenient ? "application/octet-stream" : null);
  if (!mime) throw new AppError(`${f.name}: this file type can't be attached (images, video, audio, PDF, Office, CSV, text and ZIP are supported).`);
  if (f.bytes.length > MAX_FILE_BYTES) throw new AppError(`${f.name} is larger than 25 MB.`);
  if (!f.bytes.length) throw new AppError(`${f.name} is empty.`);
  const id = randomUUID();
  const rel = `${projectId}/${id}.${EXT[mime] ?? "bin"}`;
  const abs = path.join(filesRoot(), rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, f.bytes);
  const name = path.basename(f.name || "file").replace(/[^\w.\- ()@+]/g, "_").slice(0, 160) || `file.${EXT[mime] ?? "bin"}`;
  await query("INSERT INTO cx_inbox_files(id,project_id,ticket_id,filename,mime,size,file,public_token,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
    id, projectId, ticketId, name, mime, f.bytes.length, rel, randomBytes(24).toString("base64url"), userId,
  ]);
  return { id, name, type: mime, size: f.bytes.length, url: fileUrl(id) };
}

/** Files of a brand by id (unknown or foreign ids are dropped). */
export async function getFiles(projectId: string, ids: string[]) {
  if (!ids.length) return [];
  return query<FileRow>("SELECT id,project_id,ticket_id,filename,mime,size::int AS size,file,public_token,created_at FROM cx_inbox_files WHERE project_id=$1 AND id = ANY($2)", [projectId, ids.slice(0, 20)]);
}
export const asAttachment = (f: FileRow): Attachment => ({ id: f.id, name: f.filename, type: f.mime, size: Number(f.size), url: fileUrl(f.id) });
export async function claimFiles(projectId: string, ticketId: string, ids: string[]) {
  if (ids.length) await query("UPDATE cx_inbox_files SET ticket_id=$3 WHERE project_id=$1 AND id = ANY($2) AND ticket_id IS NULL", [projectId, ids, ticketId]);
}
export async function readFileBytes(f: { file: string }) {
  const root = path.resolve(filesRoot());
  const abs = path.resolve(root, f.file);
  if (!abs.startsWith(root + path.sep)) throw new AppError("Invalid file path.", 400);
  return readFile(abs);
}
/** For the authenticated download route: any member of the file's brand (viewers included). */
export async function fileForUser(userId: string, id: string) {
  const [f] = await query<FileRow>("SELECT id,project_id,ticket_id,filename,mime,size::int AS size,file,public_token,created_at FROM cx_inbox_files WHERE id=$1", [id]);
  if (!f) throw new AppError("File not found.", 404);
  await getCxBrand(userId, f.project_id, { write: false });
  return f;
}
/** Live chat visitors: only files attached to an agent message of a live chat ticket. */
export async function chatFileByToken(token: string) {
  const [f] = await query<FileRow>(
    `SELECT f.id,f.project_id,f.ticket_id,f.filename,f.mime,f.size::int AS size,f.file,f.public_token,f.created_at FROM cx_inbox_files f
      WHERE f.public_token=$1 AND EXISTS (SELECT 1 FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id
        WHERE m.direction='out' AND t.channel_kind='livechat' AND m.attachments @> jsonb_build_array(jsonb_build_object('id', f.id)))`,
    [token],
  );
  return f ?? null;
}
/** Public links (by token) for files attached to messages shown in the chat widget. */
export async function chatFileLinks(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await query<{ id: string; public_token: string }>("SELECT id,public_token FROM cx_inbox_files WHERE id = ANY($1)", [ids]);
  return new Map(rows.map((r) => [r.id, `/api/cx/chat/files/${r.public_token}`]));
}
