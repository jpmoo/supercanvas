// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
//
// The canvas's ink, drawn (ink.ts): an SVG the size of the edges' (CanvasView,
// `.cv-svg`), inside the panned and zoomed layer, above the cards — ink is
// written over things. It takes no pointer itself; while an ink tool is chosen
// it hears the canvas's presses first (capture), takes the pen's and the
// mouse's, and leaves a finger's to the canvas, which pans and zooms with it.

import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { inkOf } from "../api.ts";
import type { InkItem } from "../document.ts";
import { nativeDrawing, wipeDevicePen } from "../nativePen.ts";
import { begin, cancel, centerline, end, erasingByEnd, extend, inkState, onInk, onLive, outline, paint, resolveColor, retrace, setInk } from "../ink.ts";

/** How the canvas sits on the screen: the layer's own transform and the wrap's place (as CanvasTools does). */
type View = { left: number; top: number; e: number; f: number; z: number };
function viewOf(wrap: HTMLElement): View {
  const layer = wrap.querySelector(".cv-layer") as HTMLElement | null;
  const m = new DOMMatrix(layer ? getComputedStyle(layer).transform : "none");
  const box = wrap.getBoundingClientRect();
  return { left: box.left, top: box.top, e: m.e, f: m.f, z: m.a || 1 };
}

/** A kept stroke's path, worked out once: the strokes don't change, and the outline is the costly part. */
const paths = new WeakMap<InkItem, string>();
function pathOf(s: InkItem): string {
  let d = paths.get(s);
  if (d === undefined) {
    d = s.tool === "highlighter" ? centerline(s.points) : outline(s.points, s.width);
    paths.set(s, d);
  }
  return d;
}
const radius = (width: number, pr: number) => (width / 2) * (0.35 + 0.65 * Math.max(0.05, Math.min(1, pr || 0.5)));

export function InkLayer({ span, chosen = [] }: { span: number; chosen?: string[] }) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const svg = useRef<SVGSVGElement | null>(null);
  /*
   * Strokes the device has drawn (Supernote's pen) that the page holds back for now: drawn hidden, so while
   * writing the screen shows the device's own ink alone — not that and the page's copy, a little different,
   * on top of it, nor a letter wiped and redrawn as the next is written. When writing pauses (or a finger,
   * another tool, or leaving the app interrupts) they are shown; the device's copy goes later (letGo).
   */
  const swapPending = useRef(new Set<string>());
  useEffect(() => onInk(redraw), []);

  // The pen's presses, while an ink tool is chosen: heard before the canvas's own handlers (capture), and kept from
  // them, so drawing neither pans nor sweeps a selection. A finger's go on to the canvas.
  useEffect(() => {
    const wrap = svg.current?.closest(".cv-wrap") as HTMLElement | null;
    if (!wrap) return;
    let drawing: number | null = null;
    // The view is still while a stroke is drawn: read once as it begins, not at every point
    // (each read made the browser lay the page out again).
    let view: View = viewOf(wrap);

    /*
     * The stroke in hand is drawn straight onto a canvas of its own over the
     * wrap, a piece at a time as the pen moves, and nothing else is drawn
     * again until the pen lifts; then the kept stroke appears in the SVG and
     * this is wiped (after that render, so there's no gap).
     */
    const sheet = document.createElement("canvas");
    sheet.className = "cv-ink-live";
    wrap.appendChild(sheet);
    const ctx = (sheet.getContext("2d", { desynchronized: true } as CanvasRenderingContext2DSettings)
      ?? sheet.getContext("2d"))!;
    let drawn = 0;
    let color = "#000";
    /** The line in hand is drawn by the device itself (nativePen): this sheet stays out of it. */
    let byDevice = false;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(wrap.clientWidth * dpr), h = Math.round(wrap.clientHeight * dpr);
      if (sheet.width !== w || sheet.height !== h) { sheet.width = w; sheet.height = h; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    // Cleared only when something was drawn on it: clearing a sheet the size of the screen makes the page
    // repaint all of it, and on the Nomad that refresh blanks Supernote's ink being written over it.
    let sheetDrawn = false;
    const wipe = () => {
      if (!sheetDrawn) return;
      sheetDrawn = false;
      ctx.clearRect(0, 0, sheet.width, sheet.height);
    };
    (wrap as HTMLElement & { wipeInk?: () => void }).wipeInk = () => {
      if (drawing !== null) return;
      wipe();
    };

    /*
     * The held-back strokes shown (see swapPending) once writing pauses — but the device's copy of them is
     * kept, over the page's: clearing it is what blanked a word on the Nomad until the panel next refreshed
     * the page's own pixels, a few seconds on. It is let go only when it would be wrong to keep — the view
     * about to move (a finger, a wheel), a tool or control chosen, the app put away, the canvas drawn afresh.
     */
    const pendingSwap = swapPending.current;
    const SWAP_IDLE_MS = 1500;
    let swapTimer = 0;
    let deviceHas = false;
    const swapNow = () => {
      clearTimeout(swapTimer);
      swapTimer = 0;
      if (!pendingSwap.size) return;
      pendingSwap.clear();
      redraw();
    };
    const letGo = () => {
      const had = pendingSwap.size > 0;
      swapNow();
      if (!deviceHas) return;
      deviceHas = false;
      // A couple of frames on, so the page's strokes are on the screen before the device's go.
      if (had) requestAnimationFrame(() => requestAnimationFrame(() => wipeDevicePen()));
      else wipeDevicePen();
    };
    const scheduleSwap = () => {
      clearTimeout(swapTimer);
      const tryIt = () => {
        if (drawing !== null) { swapTimer = window.setTimeout(tryIt, 400); return; }
        swapNow();
      };
      swapTimer = window.setTimeout(tryIt, SWAP_IDLE_MS);
    };
    /** A stroke just kept that the device drew: held back until the swap. */
    const holdBack = (dev: boolean) => {
      if (!dev) return;
      deviceHas = true;
      const all = inkOf();
      const k = all[all.length - 1];
      if (k) pendingSwap.add(k.id);
      scheduleSwap();
    };
    /*
     * Let go when the device's copy would be wrong or in the way: the view moved (pan, pinch, zoom, wheel — seen
     * as the layer's transform changing), a control pressed (by pen or finger), another tool, the app put away.
     * Not merely a hand on the screen: a palm set down between words, the pen away a moment, cleared it, and the
     * panel showed nothing in its place until something redrew (2026-11-24).
     */
    const CONTROL = "button, input, textarea, .tools, .tool-menu, .cv-toolbar, .cv-minimap, .cv-minimap-open, .menu, .ctx-menu, .files-backdrop";
    const interrupt = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.(CONTROL)) letGo();
    };
    const layer = wrap.querySelector(".cv-layer");
    let transformWas = layer ? (layer as HTMLElement).style.transform : "";
    const viewMoved = new MutationObserver(() => {
      const now = layer ? (layer as HTMLElement).style.transform : "";
      if (now !== transformWas) { transformWas = now; letGo(); }
    });
    if (layer) viewMoved.observe(layer, { attributes: true, attributeFilter: ["style"] });
    let toolWas = `${inkState().on} ${inkState().tool}`;
    const unTool = onInk(() => {
      const now = `${inkState().on} ${inkState().tool}`;
      if (now !== toolWas) { toolWas = now; letGo(); }
    });
    const away = () => { if (document.visibilityState !== "visible") letGo(); };
    window.addEventListener("pointerdown", interrupt, true);
    window.addEventListener("wheel", letGo, { capture: true, passive: true });
    document.addEventListener("visibilitychange", away);
    const toScreen = (x: number, y: number) => [x * view.z + view.e, y * view.z + view.f] as const;
    const paintLive = (kind: "begin" | "point" | "end") => {
      const l = inkState().live;
      if (kind === "end" || !l || byDevice) return;
      if (kind === "begin") {
        fit();
        wipe();
        drawn = 0;
        color = resolveColor(l.color);
      }
      const pts = l.points;
      sheetDrawn = true;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      if (l.tool === "highlighter") {
        // Translucent: overlapping pieces would darken, so the whole line again (still cheap on its own canvas).
        wipe();
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = l.width * view.z;
        ctx.beginPath();
        pts.forEach((p, i) => { const [x, y] = toScreen(p[0], p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        if (pts.length === 1) ctx.lineTo(...toScreen(pts[0]![0] + 0.01, pts[0]![1]));
        ctx.stroke();
        ctx.globalAlpha = 1;
        drawn = pts.length;
        return;
      }
      if (drawn === 0) {
        const [x, y] = toScreen(pts[0]![0], pts[0]![1]);
        ctx.beginPath();
        ctx.arc(x, y, radius(l.width, pts[0]![2]) * view.z, 0, Math.PI * 2);
        ctx.fill();
        drawn = 1;
      }
      for (; drawn < pts.length; drawn++) {
        const a = pts[drawn - 1]!, b = pts[drawn]!;
        ctx.lineWidth = 2 * radius(l.width, b[2]) * view.z;
        ctx.beginPath();
        ctx.moveTo(...toScreen(a[0], a[1]));
        ctx.lineTo(...toScreen(b[0], b[1]));
        ctx.stroke();
      }
    };
    const unLive = onLive(paintLive);
    // The pen near (hovering or drawing — as the pointer, since Talaris takes the pen as one; and a mouse alike):
    // while it is, and a moment after, a finger on the canvas is ignored outright — a hand resting on the screen
    // neither pans, taps nor pinches. With the pen away, fingers pan and zoom as ever.
    let penNear = 0;
    const PEN_NEAR_MS = 900;
    const near = () => inkState().on && performance.now() - penNear < PEN_NEAR_MS;
    // The pen alone: on the Nomad its native pen writing sends the page stray "mouse" events now and then, which
    // counted as the pen near kept every finger ignored, and pinching did nothing.
    const hovered = (e: PointerEvent) => { if (e.pointerType === "pen") penNear = performance.now(); };
    const palm = (e: Event) => {
      const touch = e instanceof PointerEvent ? e.pointerType === "touch" : true;
      if (touch && near()) { e.preventDefault(); e.stopPropagation(); }
    };
    const point = (e: PointerEvent) => {
      const x = (e.clientX - view.left - view.e) / view.z, y = (e.clientY - view.top - view.f) / view.z;
      // A mouse says no pressure (0, or 0.5 while pressed): drawn at the middle.
      const pr = e.pointerType === "pen" ? (e.pressure || 0.5) : 0.5;
      return { p: [x, y, pr] as [number, number, number], z: view.z };
    };
    /** A finger that draws (the Finger setting): one at a time, and not while the pen is near. */
    const fingerDraws = (e: PointerEvent) =>
      e.pointerType === "touch" && inkState().on && inkState().finger && !near();
    // The fingers down, by pointer: let go of on the window, so one lifted off the canvas still counts as gone.
    const fingers = new Set<number>();
    const gone = (e: PointerEvent) => { if (e.pointerType === "touch") fingers.delete(e.pointerId); };
    window.addEventListener("pointerup", gone, true);
    window.addEventListener("pointercancel", gone, true);
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        fingers.add(e.pointerId);
        // A second finger: whatever the first began is not a stroke but a pinch. Thrown away,
        // and both fingers left to the canvas, which zooms and pans with them.
        if (fingers.size > 1) {
          if (drawing !== null) { drawing = null; cancel(); wipe(); }
          return;
        }
        if (!fingerDraws(e)) { palm(e); return; }
      } else if (e.pointerType === "pen") penNear = performance.now();
      // With the pen's eraser end, ink is erased whether or not a pen tool is chosen.
      if ((!inkState().on && !erasingByEnd()) || e.button !== 0) return;
      // Over the canvas's own controls (a card's menu, a field): theirs.
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable=true], .menu, .ctx-menu, button, .cv-minimap")) return;
      e.preventDefault();
      e.stopPropagation();
      drawing = e.pointerId;
      view = viewOf(wrap);
      byDevice = e.pointerType === "pen" && !erasingByEnd() && nativeDrawing();
      try { wrap.setPointerCapture(e.pointerId); } catch { /* gone already */ }
      const { p, z } = point(e);
      begin(p, z);
    };
    const move = (e: PointerEvent) => {
      hovered(e);
      if (e.pointerType === "touch" && drawing !== e.pointerId) { palm(e); return; }
      if (drawing !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      // Every sample the pen gave since the last frame, not only the last: a quick stroke stays smooth.
      const samples = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const s of samples.length ? samples : [e]) {
        const { p, z } = point(s);
        extend(p, z);
      }
    };
    /*
     * The stroke Supernote's pen drew, kept as it drew it: every sample the device had (MainActivity.penStrokes),
     * not only the page's, about one a frame — with which the kept stroke came out smoothed or cornered where the
     * line on the screen was neither. The device queues each stroke as it ends; the one taken is the one that
     * begins where this one did (the next may have ended already, if written quickly — kept for its own turn),
     * and if none does, the page's own points stand. Points under half a screen pixel apart are left out.
     */
    let deviceStrokes: [number, number, number][][] = [];
    const retraceFromDevice = () => {
      const raw = (window as unknown as { SC?: { penStrokes?: () => string } }).SC?.penStrokes?.();
      if (raw) {
        try { deviceStrokes.push(...(JSON.parse(raw) as [number, number, number][][])); } catch { /* none */ }
      }
      const began = inkState().live?.points[0];
      if (!began) return;
      // The page's first point, on the screen, as the device's are.
      const bx = began[0] * view.z + view.e + view.left, by = began[1] * view.z + view.f + view.top;
      const at = deviceStrokes.findIndex((st) => st.length > 0 && Math.hypot(st[0]![0] - bx, st[0]![1] - by) <= 12);
      if (at < 0) { deviceStrokes = deviceStrokes.slice(-8); return; }
      const samples = deviceStrokes[at]!;
      deviceStrokes = deviceStrokes.slice(at + 1);
      const pts: [number, number, number][] = [];
      for (const [cx, cy, pr] of samples) {
        const last = pts[pts.length - 1];
        // The pen lifting says no pressure at all: kept at the last pressure, not pinched to a point.
        const p: [number, number, number] = [(cx - view.left - view.e) / view.z, (cy - view.top - view.f) / view.z, pr || last?.[2] || 0.5];
        if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) * view.z < 0.5) { last[2] = Math.max(last[2], p[2]); continue; }
        pts.push(p);
      }
      retrace(pts);
    };
    const up = (e: PointerEvent) => {
      if (drawing !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      drawing = null;
      const dev = byDevice;
      if (dev) retraceFromDevice();
      end();
      holdBack(dev);
    };
    const lost = (e: PointerEvent) => {
      if (drawing !== e.pointerId) return;
      drawing = null;
      const dev = byDevice;
      end();
      holdBack(dev);
    };
    wrap.addEventListener("pointerdown", down, true);
    // The canvas pinches and pans with touch events of its own (CanvasView): kept from them too while the pen is near.
    wrap.addEventListener("touchstart", palm, { capture: true, passive: false });
    wrap.addEventListener("touchmove", palm, { capture: true, passive: false });
    wrap.addEventListener("pointermove", move, true);
    wrap.addEventListener("pointerup", up, true);
    wrap.addEventListener("pointercancel", lost, true);
    return () => {
      letGo();
      unTool();
      window.removeEventListener("pointerdown", interrupt, true);
      viewMoved.disconnect();
      window.removeEventListener("wheel", letGo, true);
      document.removeEventListener("visibilitychange", away);
      unLive();
      sheet.remove();
      wrap.removeEventListener("pointerdown", down, true);
      wrap.removeEventListener("touchstart", palm, true);
      wrap.removeEventListener("touchmove", palm, true);
      wrap.removeEventListener("pointermove", move, true);
      wrap.removeEventListener("pointerup", up, true);
      wrap.removeEventListener("pointercancel", lost, true);
      window.removeEventListener("pointerup", gone, true);
      window.removeEventListener("pointercancel", gone, true);
    };
  }, []);

  // Escape puts the pen down. (Undo and redo are the whole canvas's now: main.tsx, api.ts.)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.("input, textarea, [contenteditable=true]")) return;
      if (e.key === "Escape" && inkState().on) {
        cancel();
        setInk(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // The kept stroke is in the SVG now: the live sheet's copy of it can go.
  useLayoutEffect(() => {
    const wrap = svg.current?.closest(".cv-wrap") as (HTMLElement & { wipeInk?: () => void }) | null;
    wrap?.wipeInk?.();
  });

  // Strokes held back for the swap (swapPending) aren't in the page at all yet: even an invisible element
  // added to this canvas-sized layer makes the page repaint, which blanks Supernote's ink as it's written.
  const strokes = swapPending.current.size ? inkOf().filter((k) => !swapPending.current.has(k.id)) : inkOf();
  // What the Select tool has chosen: a dashed box round each chosen stroke.
  const chosenInk = chosen.some((id) => id.startsWith("ink-")) ? new Set(chosen) : null;
  // Highlighters first, the pen's over them.
  const order = [...strokes].sort((a, b) => Number(b.tool === "highlighter") - Number(a.tool === "highlighter"));
  return (
    <svg
      ref={svg}
      className="cv-ink"
      width={span}
      height={span}
      viewBox={`${-span / 2} ${-span / 2} ${span} ${span}`}
      style={{ left: -span / 2, top: -span / 2 }}
    >
      {order.map((s) =>
        s.tool === "highlighter" ? (
          <path key={s.id} transform={`translate(${s.x} ${s.y})`} d={pathOf(s)} style={{ fill: "none", stroke: paint(s.color) }}
            strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" opacity={0.35} />
        ) : (
          <path key={s.id} transform={`translate(${s.x} ${s.y})`} d={pathOf(s)} style={{ fill: paint(s.color) }} />
        ),
      )}
      {chosenInk && strokes.filter((k) => chosenInk.has(k.id)).map((k) => (
        <rect key={`c${k.id}`} className="cv-ink-chosen" x={k.x - 3} y={k.y - 3} width={k.w + 6} height={k.h + 6} />
      ))}
    </svg>
  );
}
