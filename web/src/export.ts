// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
/*
 * The whole canvas as a picture: a PNG, or a PDF of one page, saved beside the
 * canvas file.
 *
 * The truest picture of the canvas is the canvas as drawn, so that is what is
 * kept: the app's own bars put away, everything fitted into the picture's size
 * (CanvasView, "supercanvas-fit"), and the WebView drawn at that size by the
 * device (MainActivity.exportPicture). Then the view is put back as it was.
 * In a desktop browser there is no device to draw it, and it says so.
 */
import * as store from "./store.ts";

type Bridge = { exportPicture?(kind: string, w: number, h: number, path: string): void };
const bridge = (window as unknown as { SC?: Bridge }).SC;

type View = { x: number; y: number; z: number };
type Rect = { x: number; y: number; w: number; h: number };

/** The longest side of the picture, in CSS pixels (times the screen's density on the device), and its margin. */
const LONG_EDGE = 1800, PAD = 40;
/** At most this enlarged: a small canvas isn't blown up into a blur. */
const MAX_ZOOM = 1.5;

function ask(w: number, h: number): Promise<{ prev: View; bounds: Rect | null }> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent("supercanvas-fit", { detail: { w, h, pad: PAD, reply: resolve } }));
  });
}
const frames = (n: number) => new Promise<void>((r) => {
  const step = () => (n-- <= 0 ? r() : requestAnimationFrame(step));
  step();
});

/** A name for the picture beside the canvas, not taken yet: "Title.png", "Title 2.png", … */
function pictureName(canvas: string, ext: string): string {
  const folder = store.parentOf(canvas);
  const taken = store.namesIn(folder);
  const title = store.titleOf(canvas);
  let name = `${title}.${ext}`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${title} ${i}.${ext}`;
  return folder ? `${folder}/${name}` : name;
}

let busy = false;

/** The canvas at `canvas` (its path) exported; the saved picture's path, or why not. */
export async function exportCanvas(canvas: string, kind: "png" | "pdf"): Promise<{ ok: boolean; message: string }> {
  if (!bridge?.exportPicture) return { ok: false, message: "Exporting works on the Nomad." };
  if (busy) return { ok: false, message: "Already exporting." };
  const { bounds } = await ask(0, 0);
  if (!bounds) return { ok: false, message: "There's nothing on this canvas to export." };
  busy = true;
  const zoom = Math.min(MAX_ZOOM, (LONG_EDGE - PAD * 2) / Math.max(bounds.w, bounds.h));
  const w = Math.round(bounds.w * zoom + PAD * 2), h = Math.round(bounds.h * zoom + PAD * 2);
  const dpr = window.devicePixelRatio || 1;
  const path = pictureName(canvas, kind);
  const root = document.documentElement;
  root.classList.add("sc-exporting");
  const { prev } = await ask(w, h);
  await frames(2);
  const ok = await new Promise<boolean>((resolve) => {
    const sc = (window as unknown as { sc?: Record<string, unknown> }).sc;
    if (sc) sc.exported = (done: boolean) => resolve(done);
    bridge.exportPicture!(kind, Math.round(w * dpr), Math.round(h * dpr), path);
  });
  root.classList.remove("sc-exporting");
  window.dispatchEvent(new CustomEvent("supercanvas-view", { detail: prev }));
  busy = false;
  return ok
    ? { ok, message: `Saved “${store.nameOf(path)}” beside the canvas.` }
    : { ok, message: "Couldn't export the canvas." };
}
