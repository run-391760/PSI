"use client";

/**
 * Renders a DOM node (card with a Recharts SVG, KPI or table) to a PNG and downloads it. Works by
 * cloning the node with every computed style inlined into an SVG <foreignObject>, then drawing that
 * onto a canvas at 2× scale. No external libraries.
 */
function inlineStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  let css = "";
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i];
    css += `${p}:${cs.getPropertyValue(p)};`;
  }
  (dst as HTMLElement).setAttribute("style", css);
  if (src instanceof SVGElement) for (const a of ["fill", "stroke"]) {
    const v = cs.getPropertyValue(a);
    if (v) dst.setAttribute(a, v);
  }
  const a = src.children, b = dst.children;
  for (let i = 0; i < a.length && i < b.length; i++) inlineStyles(a[i], b[i]);
}

export async function downloadNodePng(node: HTMLElement, filename: string) {
  const rect = node.getBoundingClientRect();
  const w = Math.ceil(rect.width), h = Math.ceil(rect.height);
  const clone = node.cloneNode(true) as HTMLElement;
  inlineStyles(node, clone);
  clone.querySelectorAll(".no-print,[data-no-export]").forEach((el) => el.remove());
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const bg = getComputedStyle(document.body).backgroundColor || "#fff";
  const xml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
  const img = new Image();
  img.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not render the chart image."));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Could not create the PNG.");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "export";

/** Downloads text content as a file (CSV from server actions). */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([type.startsWith("text/csv") ? "﻿" + text : text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
