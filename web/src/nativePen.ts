// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
/*
 * The device's own pen, for the line as it is written.
 *
 * The page hears the pen and keeps the stroke as ever (ink.ts); this only has
 * the line drawn at once, as it is written, by something faster than the page.
 * On while the pen tool (not the highlighter or eraser) is in hand, in its
 * color and width at the zoom shown, never over the app's own controls.
 *
 * Two ways on the Nomad, one or the other — never both in one run:
 *
 *  - Supernote's own real-time pen (RattaPen.java), the one its notes use:
 *    fast and in grays. The default. Its strokes are tagged as Supercanvas's,
 *    so Supernote's notes app leaves them be (RattaPen.CALLER).
 *
 *  - The e-ink controller's generic pen-writing layer (MainActivity.pwOn,
 *    PenWrite.java): fast, black and white while writing. Only where
 *    Supernote's pen isn't there, or turned off (localStorage
 *    "supercanvas.rattaPen" = "off"). Both draw into the controller's one
 *    pen-writing layer, and setting this one up left the controller so that
 *    Supernote's pen drew a gray box round every stroke until the Nomad was
 *    restarted (2026-11-23) — so once Supernote's pen answers, this one is
 *    never so much as created.
 *
 * Elsewhere — a desktop browser, another tablet — neither, and the screen is
 * asked for its fast refresh while ink is in hand (store.einkFast).
 */
import { INK_SIZES, inkState, onInk, resolveColor } from "./ink.ts";
import { einkFast } from "./store.ts";

type Bridge = {
  pwOn?(on: boolean, color: number, width: number, unwritable: string): boolean;
  pwClear?(): void;
  snCall?(code: number, ints: string): string;
  einkRefresh?(l: number, t: number, r: number, b: number, mode: number): string;
  einkScreenRefresh?(full: boolean, mode: number): string;
};
const bridge = (window as unknown as { SC?: Bridge }).SC;

/** Where pen writing isn't wanted: the app's own controls. */
const CONTROLS = ".tools, .cv-toolbar, .tool-menu, .cv-zoom, .cv-minimap, .cv-minimap-open, .sc-title, .menu, .ctx-menu, .files-backdrop, .cv-chosen-actions, .cv-entity-panel, .cv-find, .sc-notice";
/** Over the whole screen while open (a dialog, the canvases, a picker): the pen writes nowhere at all. */
const COVERS = ".modal-backdrop, .files-backdrop";

const rattaAsked = (() => {
  try { return localStorage.getItem("supercanvas.rattaPen") !== "off"; } catch { return true; }
})();

type Way = "ratta" | "pw" | "none";
let way: Way | null = null; // unknown until first asked
let sent = "";
let fastAsked = false;

/** The device's pen is drawing the line in hand (so the page needn't draw it as well). */
export const nativeDrawing = () => (way === "ratta" || way === "pw") && sent.startsWith("on");

function rgb(color: string): number {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillStyle = resolveColor(color);
  const hex = String(ctx.fillStyle);
  return /^#([0-9a-f]{6})$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0;
}

function zoom(): number {
  const layer = document.querySelector(".cv-layer") as HTMLElement | null;
  return layer ? new DOMMatrix(getComputedStyle(layer).transform).a || 1 : 1;
}

/** The controls' boxes on the screen, in device pixels: [left, top, right, bottom]. */
function controls(): number[][] {
  const dpr = devicePixelRatio || 1;
  return [...document.querySelectorAll(CONTROLS)].map((el) => {
    const r = el.getBoundingClientRect();
    return [Math.floor(r.left * dpr), Math.floor(r.top * dpr), Math.ceil(r.right * dpr), Math.ceil(r.bottom * dpr)];
  }).filter(([l, t, r, b]) => r > l && b > t);
}

// ------------------------------------------------------------ the e-ink pen-writing layer

function pwSync(want: boolean): boolean {
  if (!bridge?.pwOn) return false;
  const s = inkState();
  let key = "off", color = 0, width = 0, rects = "[]";
  if (want) {
    color = (0xff000000 | rgb(s.color)) | 0;
    width = Math.round(INK_SIZES.pen[s.size]! * zoom() * (devicePixelRatio || 1) * 0.6);
    rects = JSON.stringify(controls());
    key = `on ${color} ${width} ${rects}`;
  }
  if (key === sent) return true;
  const ok = bridge.pwOn(want, color, width, rects);
  if (ok) sent = key;
  return ok;
}

// ------------------------------------------------------------ Supernote's real-time pen

/* Its messages (its client in Supernote's notes app, HandWriteClient). */
const AREAS = 1, PEN = 2, SYNC = 6;
const RATTA_WIDTH = 0.58;
const EVERYWHERE = [1, 0, 0, 18888, 18888, 0], NOWHERE = [1, 0, 0, 19999, 19999, 0];
const snTell = (code: number, ints: number[]) => (bridge?.snCall?.(code, JSON.stringify(ints)) ?? "").startsWith("ok");

/** A color as the service's four: black (0), its two grays (-102, -101) or white (254), by how light it is. */
function shade(color: string): number {
  const n = rgb(color);
  const light = (0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
  return light < 0.3 ? 0 : light < 0.6 ? -102 : light < 0.9 ? -101 : 254;
}

function rattaSync(want: boolean): boolean {
  if (!bridge?.snCall) return false;
  const s = inkState();
  let key = "off", pen: number[] = [], keepOff: number[] = [];
  if (want) {
    // At the width the page will draw the kept stroke (InkLayer's radius: 0.35 + 0.65 × pressure of it, about
    // 0.7 at the Nomad pen's usual pressure, 0.55), so the line doesn't thin a little as the swap happens.
    pen = [10, Math.round(INK_SIZES.pen[s.size]! * RATTA_WIDTH * zoom() * (devicePixelRatio || 1) * 100), shade(s.color)];
    const rects = controls();
    keepOff = [rects.length, ...rects.flatMap(([l, t, r, b]) => [l, t, r - l, b - t, 0])];
    key = `on ${JSON.stringify([pen, keepOff])}`;
  }
  if (key !== sent) {
    let ok: boolean;
    if (want) {
      ok = snTell(PEN, pen) && snTell(AREAS, EVERYWHERE);
      if (ok && keepOff[0]) ok = snTell(AREAS, keepOff);
    } else ok = snTell(AREAS, NOWHERE);
    if (!ok) return false;
    sent = key;
  }
  return true;
}

// ------------------------------------------------------------ either

function sync() {
  const s = inkState();
  const want = s.on && s.tool === "pen" && document.visibilityState === "visible" && !document.querySelector(COVERS);
  if (way === null) {
    if (rattaAsked && bridge?.snCall) {
      // Supernote's pen, or nothing yet: asked again next time rather than falling back to the generic
      // layer, which would leave the controller drawing gray boxes round its strokes until a restart.
      way = rattaSync(want) ? "ratta" : null;
    } else way = pwSync(want) ? "pw" : want ? "none" : null;
  }
  else if (way === "ratta") rattaSync(want);
  else if (way === "pw") pwSync(want);
  if (way === "ratta" || way === "pw") {
    // The fast refresh is black and white only: never left on where the device draws the line itself.
    if (fastAsked) { fastAsked = false; einkFast(false); }
    return;
  }
  // Neither: the next best, the screen's fast refresh while any ink tool is in hand.
  if (s.on !== fastAsked) { fastAsked = s.on; einkFast(s.on); }
}

/** Again after the view moves (a pan or zoom ends) or the bars change, a frame on, once things have drawn. */
let pending = 0;
export function resyncPen() {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => requestAnimationFrame(sync));
}

/**
 * The page's strokes are on the screen: the device's own copy of them let go — the pen-writing layer wiped,
 * or Supernote's drawing buffer cleared (its message 6 with a second value that isn't 0, as at its own
 * pen-down). InkLayer calls this once writing pauses, not after every stroke.
 */
export function wipeDevicePen() {
  if (way === "pw") bridge?.pwClear?.();
  else if (way === "ratta") snTell(SYNC, [255, 1]);
}

onInk(resyncPen);
addEventListener("resize", resyncPen);
addEventListener("pointerup", (e) => { if (e.pointerType !== "pen") resyncPen(); }, true);
addEventListener("touchend", resyncPen, true);
addEventListener("wheel", resyncPen, { passive: true });
// Something shown or taken away — a dialog, the chosen things' buttons, a menu — most often after a tap with the
// pen itself, which the pointerup above leaves out: told again, before the pen comes down on it.
new MutationObserver(resyncPen).observe(document.body, { childList: true, subtree: true });
// Away and back: told again (MainActivity turns Supernote's pen off as the app goes to the background).
addEventListener("visibilitychange", () => { sent = ""; sync(); });
