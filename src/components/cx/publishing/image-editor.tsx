"use client";

import { FlipHorizontal, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { CROP_PRESETS, cropRect, outputSize } from "@/lib/cx/publishing/suggest";

/**
 * Client-side image edit/crop: aspect presets with network pixel sizes (or custom pixels), zoom, drag to
 * position, rotate and flip. Saves a new asset (the original is kept).
 */
export function ImageEditor({ brandId, asset, onClose, onSaved }: { brandId: string; asset: { id: string; filename: string; mime: string } | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [preset, setPreset] = useState<string>("ig-square");
  const [customW, setCustomW] = useState(1200);
  const [customH, setCustomH] = useState(1200);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 });
  const [rot, setRot] = useState(0);
  const [flip, setFlip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  useEffect(() => {
    if (!asset) return;
    setImg(null);
    setError(null);
    setZoom(1);
    setCenter({ x: 0.5, y: 0.5 });
    setRot(0);
    setFlip(false);
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setError("Could not load the image.");
    i.src = `/api/cx/publishing/assets/${asset.id}`;
  }, [asset]);

  // Rotated/flipped source dimensions.
  const src = useMemo(() => {
    if (!img) return null;
    const swap = rot % 180 !== 0;
    return { w: swap ? img.naturalHeight : img.naturalWidth, h: swap ? img.naturalWidth : img.naturalHeight };
  }, [img, rot]);
  const p = CROP_PRESETS.find((x) => x.id === preset) ?? null;
  const target = preset === "custom" ? { w: Math.max(16, customW), h: Math.max(16, customH) } : preset === "original" ? null : p;
  const aspect = target ? target.w / target.h : null;
  const crop = src ? cropRect(src.w, src.h, aspect, zoom, center.x, center.y) : null;
  const out = crop ? outputSize(crop, target) : null;

  const drawSource = (ctx: CanvasRenderingContext2D, scale: number) => {
    if (!img) return;
    ctx.save();
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const sw = rot % 180 ? h : w;
    const sh = rot % 180 ? w : h;
    ctx.translate(sw / 2, sh / 2);
    ctx.rotate((rot * Math.PI) / 180);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  };

  useEffect(() => {
    const c = previewRef.current;
    if (!c || !src) return;
    const scale = Math.min(1, 560 / src.w, 340 / src.h);
    c.width = Math.round(src.w * scale);
    c.height = Math.round(src.h * scale);
    const ctx = c.getContext("2d")!;
    drawSource(ctx, scale);
    if (crop) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.beginPath();
      ctx.rect(0, 0, c.width, c.height);
      ctx.rect(crop.x * scale, crop.y * scale, crop.w * scale, crop.h * scale);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(crop.x * scale, crop.y * scale, crop.w * scale, crop.h * scale);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!img || !crop || !out || !asset) return;
    setBusy(true);
    setError(null);
    try {
      const full = document.createElement("canvas");
      full.width = src!.w;
      full.height = src!.h;
      drawSource(full.getContext("2d")!, 1);
      const o = document.createElement("canvas");
      o.width = out.w;
      o.height = out.h;
      const ctx = o.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(full, crop.x, crop.y, crop.w, crop.h, 0, 0, out.w, out.h);
      const png = asset.mime === "image/png";
      const blob = await new Promise<Blob | null>((r) => o.toBlob(r, png ? "image/png" : "image/jpeg", 0.9));
      if (!blob) throw new Error("Could not encode the image.");
      const base = asset.filename.replace(/\.[^.]+$/, "");
      const fd = new FormData();
      fd.set("brand", brandId);
      fd.set("tags", "edited");
      fd.append("file", new File([blob], `${base}-${out.w}x${out.h}.${png ? "png" : "jpg"}`, { type: png ? "image/png" : "image/jpeg" }));
      const res = await fetch("/api/cx/publishing/assets", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { ids?: string[]; error?: string; errors?: string[] };
      if (!res.ok || !j.ids?.[0]) throw new Error(j.error ?? j.errors?.join(" ") ?? "Upload failed.");
      onSaved(j.ids[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Saving failed.");
    } finally {
      setBusy(false);
    }
  };

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>, phase: "down" | "move" | "up") => {
    const c = previewRef.current;
    if (!c) return;
    if (phase === "down") {
      c.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, cx: center.x, cy: center.y };
    } else if (phase === "move" && drag.current) {
      const r = c.getBoundingClientRect();
      setCenter({ x: Math.min(1, Math.max(0, drag.current.cx + (e.clientX - drag.current.x) / r.width)), y: Math.min(1, Math.max(0, drag.current.cy + (e.clientY - drag.current.y) / r.height)) });
    } else drag.current = null;
  };

  return (
    <Dialog
      open={!!asset}
      onClose={onClose}
      size="xl"
      title="Edit image"
      description="Crop to a network size, then save as a new asset. The original stays in the library."
      error={img ? error : null}
      initialFocus="none"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !img} loading={busy} onClick={save}>Save as new asset</Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-md bg-surface-3">
          {img ? (
            <canvas ref={previewRef} className="max-w-full cursor-move touch-none" onPointerDown={(e) => onPointer(e, "down")} onPointerMove={(e) => onPointer(e, "move")} onPointerUp={(e) => onPointer(e, "up")} aria-label="Drag to position the crop" />
          ) : (
            <span className="text-[12.5px] text-text-3">{error ?? "Loading…"}</span>
          )}
        </div>
        <div className="grid content-start gap-3">
          <Field label="Size" htmlFor="ie-preset">
            <Select id="ie-preset" value={preset} onChange={(e) => { setPreset(e.target.value); setCenter({ x: 0.5, y: 0.5 }); }}>
              {CROP_PRESETS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              <option value="custom">Custom pixels</option>
              <option value="original">Free (original ratio)</option>
            </Select>
          </Field>
          {preset === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Width" htmlFor="ie-w"><Input id="ie-w" type="number" min={16} max={4096} value={customW} onChange={(e) => setCustomW(Math.min(4096, Number(e.target.value) || 0))} /></Field>
              <Field label="Height" htmlFor="ie-h"><Input id="ie-h" type="number" min={16} max={4096} value={customH} onChange={(e) => setCustomH(Math.min(4096, Number(e.target.value) || 0))} /></Field>
            </div>
          )}
          <Field label={`Zoom ${zoom.toFixed(1)}×`} htmlFor="ie-zoom">
            <input id="ie-zoom" type="range" min={1} max={4} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-[var(--brand)]" />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setRot((rot + 90) % 360)}><RotateCw className="h-3.5 w-3.5" /> Rotate</Button>
            <Button size="sm" onClick={() => setFlip(!flip)}><FlipHorizontal className="h-3.5 w-3.5" /> Flip</Button>
          </div>
          {crop && out && (
            <p className="text-[12px] text-text-2">
              Crop {crop.w}×{crop.h} px → output {out.w}×{out.h} px
              {out.upscaled && <span className="block text-warning-ink">The crop is small for this size; the image will look soft.</span>}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
