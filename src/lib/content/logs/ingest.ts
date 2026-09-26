import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import zlib from "node:zlib";
import { AppError } from "@/lib/domain";
import { LogAggregator } from "./parser";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_DECOMPRESSED = 1024 * 1024 * 1024;
const MAX_LINES = 8_000_000;

async function* webChunks(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value?.length) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Stream an uploaded .log / .gz body through the parser. Compression is detected from magic bytes. */
export async function ingestStream(body: ReadableStream<Uint8Array>, limit = MAX_UPLOAD_BYTES) {
  const it = webChunks(body)[Symbol.asyncIterator]();
  const first = await it.next();
  if (first.done) throw new AppError("The file is empty.");
  const head = Buffer.from(first.value);
  if (head[0] === 0x50 && head[1] === 0x4b) throw new AppError("ZIP archives aren't supported. Upload a .log file or a .gz compressed log.");
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  let received = 0;
  async function* raw() {
    received += head.length;
    yield head;
    for (;;) {
      const n = await it.next();
      if (n.done) return;
      received += n.value.length;
      if (received > limit) throw new AppError(`The file is larger than ${Math.round(limit / 1024 / 1024)} MB.`, 413);
      yield Buffer.from(n.value);
    }
  }
  let source: AsyncIterable<Buffer> = raw();
  if (gz) {
    const gunzip = zlib.createGunzip();
    const input = Readable.from(raw());
    input.on("error", (e) => gunzip.destroy(e));
    input.pipe(gunzip);
    source = gunzip;
  }
  const agg = new LogAggregator();
  const decoder = new StringDecoder("utf8");
  let rest = "";
  let total = 0;
  try {
    for await (const chunk of source) {
      total += chunk.length;
      if (total > MAX_DECOMPRESSED) throw new AppError("The uncompressed log is larger than 1 GB.", 413);
      const lines = (rest + decoder.write(chunk)).split("\n");
      rest = lines.pop() ?? "";
      for (const l of lines) agg.add(l.endsWith("\r") ? l.slice(0, -1) : l);
      if (agg.lines > MAX_LINES) throw new AppError(`The log has more than ${MAX_LINES.toLocaleString("en-US")} lines.`, 413);
      if (agg.lines >= 2000 && agg.parsed === 0) throw new AppError("This doesn't look like an Apache or Nginx access log (Combined or Common format).", 422);
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    const code = (e as { code?: string }).code ?? "";
    if (/Z_|INCORRECT_HEADER|zlib/i.test(code + String((e as Error).message))) throw new AppError("The .gz file is corrupt or incomplete.", 422);
    throw e;
  }
  rest += decoder.end();
  if (rest) agg.add(rest);
  if (!agg.parsed) throw new AppError("No lines in Apache/Nginx Combined or Common log format were found.", 422);
  return { agg, bytes: received, compressed: gz };
}

/** Parse an in-memory log (sample data). */
export function ingestText(text: string) {
  const agg = new LogAggregator();
  let start = 0;
  for (;;) {
    const i = text.indexOf("\n", start);
    if (i === -1) {
      agg.add(text.slice(start));
      break;
    }
    agg.add(text.slice(start, i));
    start = i + 1;
  }
  return agg;
}
