// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
//
// Ink on the canvas: a pen, a highlighter and an eraser, in a color and a
// thickness, with undo.
//
// **A stroke is an item** (document.ts, `InkItem`) — kind "ink", its box, its
// points with their pressure, its color and width — so it is saved with the
// canvas and synced between machines on its own, one record each, as a card
// is: two machines drawing at once keep both. The component never sees it as a
// note (document.ts, `notesOf`); this draws it (components/InkLayer.tsx).
//
// **The pen draws; a finger pans.** With an ink tool chosen, a press of the pen
// or the mouse draws, and one of a finger is the canvas's as ever — panning,
// and two to zoom — so a hand resting on the screen draws nothing (the mini,
// with its pen). The pen's pressure makes the line thicker as it is pressed.
//
// **Undo** is ink's own: each stroke drawn, each sweep of the eraser, Clear —
// undone and done again in order (Ctrl+Z, Ctrl+Shift+Z). Not the canvas's other
// changes, which have none yet.

import { changeInk, inkOf } from "./api.ts";
import type { InkItem } from "./document.ts";

export type InkTool = "pen" | "highlighter" | "eraser";
type Pt = [number, number, number];

/** The colors offered, the first the theme's own text (worked out as it is chosen). */
export const INK_COLORS = ["text", "#e03131", "#f08c00", "#fab005", "#2f9e44", "#1971c2", "#9c36b5"];
/** Each tool's five widths, in canvas units: fine, medium, broad, thick, heavy. */
export const INK_SIZES: Record<"pen" | "highlighter", number[]> = { pen: [3, 6, 12, 18, 27], highlighter: [14, 22, 34, 48, 64] };

interface State {
  /** An ink tool is chosen: the pen draws on the canvas. */
  on: boolean;
  tool: InkTool;
  color: string;
  size: number;
  /** A finger draws too (Supercanvas): one finger draws, two still pan and zoom. */
  finger: boolean;
  /** The stroke being drawn, in canvas units, and its look. */
  live: { points: Pt[]; color: string; width: number; tool: "pen" | "highlighter" } | null;
  /** Bumped at every change, for the layer to draw again. */
  version: number;
}

const KEPT = "talaris-ink";
function kept(): Partial<State> {
  try { return JSON.parse(localStorage.getItem(KEPT) || "{}"); } catch { return {}; }
}
const first = kept();
const state: State = {
  on: false,
  tool: first.tool === "highlighter" || first.tool === "eraser" ? first.tool : "pen",
  color: typeof first.color === "string" ? first.color : "text",
  size: typeof first.size === "number" ? Math.max(0, Math.min(INK_SIZES.pen.length - 1, first.size)) : 1,
  finger: first.finger === true,
  live: null,
  version: 0,
};
const listeners = new Set<() => void>();
/*
 * Every listener (the ink layer, the toolbar, the minimap) draws again on a
 * change, so a change is a stroke kept or a setting chosen — never a point of
 * the stroke in hand, which goes to `onLive` alone and is drawn straight onto
 * a canvas of its own (InkLayer). On the Nomad, drawing the whole layer again
 * for every point of the pen was what made writing crawl.
 */
let keptSettings = "";
function changed() {
  state.version++;
  const now = JSON.stringify({ tool: state.tool, color: state.color, size: state.size, finger: state.finger });
  if (now !== keptSettings) {
    keptSettings = now;
    try { localStorage.setItem(KEPT, now); } catch { /* private */ }
  }
  for (const f of listeners) f();
}
const liveListeners = new Set<(kind: "begin" | "point" | "end") => void>();
/** The stroke in hand: begun, a point added, or done with (kept or thrown away). */
export function onLive(f: (kind: "begin" | "point" | "end") => void): () => void {
  liveListeners.add(f);
  return () => liveListeners.delete(f);
}
const tell = (kind: "begin" | "point" | "end") => { for (const f of liveListeners) f(kind); };
export const inkState = () => state;

/**
 * The pen turned over, its eraser end near (the pen helper says, through the drawer): ink is erased with it, pen
 * chosen or not, and the tool it had comes back as the pen end returns.
 */
let byEraserEnd = false;
export const erasingByEnd = () => byEraserEnd;
export function penEnd(end: string) {
  const now = end === "eraser";
  if (now === byEraserEnd) return;
  byEraserEnd = now;
  document.documentElement.dataset.inkEnd = now ? "eraser" : "";
  changed();
}
/*
 * Supercanvas: the pen tells us itself. Android reports the eraser end of a
 * stylus as a pen with the eraser button (buttons bit 32, button 5); heard on
 * the window, before the ink layer's own capture handler, so the stroke about
 * to begin already knows which end it is.
 */
// Where the WebView says so. (The Nomad's doesn't: MainActivity watches the pen and calls penEnd through sc.)
let endFromEvents = false;
const whichEnd = (e: PointerEvent) => {
  if (e.pointerType !== "pen") return;
  const eraser = Boolean(e.buttons & 32) || e.button === 5;
  if (eraser) { endFromEvents = true; penEnd("eraser"); }
  else if (endFromEvents) { endFromEvents = false; penEnd("pen"); }
};
addEventListener("pointerdown", whichEnd, true);
addEventListener("pointermove", whichEnd, true);
export function onInk(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** An ink tool chosen, or none (Escape, the toolbar's pen again). */
export function setInk(on: boolean) {
  if (state.on === on) return;
  state.on = on;
  state.live = null;
  document.documentElement.dataset.ink = on ? state.tool : "";
  changed();
}
export function chooseTool(tool: InkTool) {
  state.tool = tool;
  state.on = true;
  document.documentElement.dataset.ink = tool;
  changed();
}
/** Whether a finger draws while an ink tool is in hand, or pans as ever. */
export function setFingerDraws(on: boolean) {
  state.finger = on;
  changed();
}
export function chooseColor(color: string) {
  state.color = color;
  if (state.tool === "eraser") chooseTool("pen");
  else changed();
}
export function chooseSize(size: number) {
  state.size = size;
  if (state.tool === "eraser") chooseTool("pen");
  else changed();
}

/** The two themes' text colors (Talaris's ui/tokens.css): a stroke kept in one before "text" was kept as itself. */
const TEXT_GRAYS = new Set(["#d5d9dc", "#25292d"]);

/** A stroke's color as an SVG paint: "text" (or an old stroke's text gray) is the theme's text color, as it changes. */
export function paint(color: string): string {
  return color === "text" || TEXT_GRAYS.has(color.toLowerCase()) ? "var(--text)" : color;
}

/** A color as drawn: "text" is the theme's text color now. */
export function resolveColor(color: string): string {
  if (color !== "text") return color;
  const v = getComputedStyle(document.documentElement).getPropertyValue("--text").trim()
    || getComputedStyle(document.body).color;
  return v || "#222";
}

// ------------------------------------------------------------ undo

type Step = { add: InkItem[]; remove: InkItem[] };
const undos: Step[] = [];
const redos: Step[] = [];
function apply(step: Step) {
  changeInk(step.add, step.remove.map((s) => s.id));
  changed();
}
function record(step: Step) {
  undos.push(step);
  if (undos.length > 200) undos.shift();
  redos.length = 0;
  apply(step);
}
export const canUndo = () => undos.length > 0;
export const canRedo = () => redos.length > 0;
export function undo() {
  const s = undos.pop();
  if (!s) return;
  redos.push(s);
  apply({ add: s.remove, remove: s.add });
}
export function redo() {
  const s = redos.pop();
  if (!s) return;
  undos.push(s);
  apply(s);
}

// ------------------------------------------------------------ selected strokes (the Select tool)

/** Strokes put `dx, dy` from where they were (`from`, as the move began): live, while the drag goes on. */
export function placeStrokes(from: InkItem[], dx: number, dy: number) {
  const moved = from.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
  changeInk(moved, from.map((s) => s.id));
  changed();
  return moved;
}
/** A move finished: one step to undo, back to where the strokes were. */
export function recordMove(from: InkItem[], to: InkItem[]) {
  if (!from.length) return;
  undos.push({ add: to, remove: from });
  if (undos.length > 200) undos.shift();
  redos.length = 0;
}
/** Strokes taken off by id, as one step to undo. */
export function removeStrokes(ids: string[]) {
  const gone = new Set(ids);
  const hit = inkOf().filter((s) => gone.has(s.id));
  if (hit.length) record({ add: [], remove: hit });
}

/** Every stroke taken off, as one step to undo. */
export function clearInk() {
  const all = inkOf();
  if (all.length) record({ add: [], remove: all });
}

// ------------------------------------------------------------ drawing

const newId = () => `ink-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** A press begun with an ink tool, at a point on the canvas: a stroke started, or the eraser's sweep. */
let erased: InkItem[] = [];
/** The tool the press in hand began with: kept to its end, whatever end of the pen turns up meanwhile. */
let pressTool: InkTool = "pen";
/** The tool a press uses: the eraser while the pen's eraser end is near, else the one chosen. */
const using = (): InkTool => (byEraserEnd ? "eraser" : state.tool);

export function begin(p: Pt, zoom: number) {
  pressTool = using();
  if (pressTool === "eraser") {
    erased = [];
    erase(p, zoom);
    return;
  }
  const tool: "pen" | "highlighter" = pressTool === "highlighter" ? "highlighter" : "pen";
  // "text" kept as itself, not as this machine's text color now: drawn in each machine's own, light or dark, theme
  // (the laptop's light gray was all but invisible on a light canvas elsewhere, 2026-11-15).
  state.live = { points: [p], color: state.color, width: INK_SIZES[tool][state.size]!, tool };
  tell("begin");
}
/** The pen moved: the stroke goes on (points closer than a screen pixel left out), or the eraser sweeps on. */
export function extend(p: Pt, zoom: number) {
  if (pressTool === "eraser") { erase(p, zoom); return; }
  const live = state.live;
  if (!live) return;
  const last = live.points[live.points.length - 1]!;
  if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1 / zoom) return;
  live.points.push(p);
  tell("point");
}
/**
 * The stroke in hand, its points all replaced: the pen's every sample, as the device recorded them (InkLayer, from
 * MainActivity.penStroke), for the page's own, a point or so a frame. Before end().
 */
export function retrace(points: Pt[]) {
  const live = state.live;
  if (!live || points.length < 2) return;
  live.points = points;
}
/** The pen lifted: the stroke kept as an item (one dot, too), or the eraser's sweep kept as one step. */
export function end() {
  if (pressTool === "eraser") {
    if (erased.length) {
      undos.push({ add: [], remove: erased });
      redos.length = 0;
    }
    erased = [];
    return;
  }
  const live = state.live;
  state.live = null;
  if (!live) return;
  const pad = live.width;
  const xs = live.points.map((p) => p[0]), ys = live.points.map((p) => p[1]);
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  const item: InkItem = {
    id: newId(), kind: "ink", x, y,
    w: Math.max(...xs) - x + pad, h: Math.max(...ys) - y + pad,
    points: live.points.map(([px, py, pr]) => [round(px - x), round(py - y), round(pr, 2)]),
    color: live.color, width: live.width, ...(live.tool === "highlighter" ? { tool: "highlighter" as const } : {}),
  };
  record({ add: [item], remove: [] });
  tell("end");
}
export function cancel() {
  const had = state.live;
  state.live = null;
  erased = [];
  if (had) { tell("end"); changed(); }
}
const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;

/** The eraser at a point: every stroke it touches, taken off whole. */
function erase(p: Pt, zoom: number) {
  const reach = 10 / zoom;
  const hit = inkOf().filter((s) => touches(s, p[0], p[1], reach));
  if (!hit.length) return;
  erased.push(...hit);
  changeInk([], hit.map((s) => s.id));
  changed();
}

/** Whether a point is within `reach` of a stroke's line (its width counted). */
export function touches(s: InkItem, x: number, y: number, reach: number): boolean {
  const r = reach + s.width / 2;
  if (x < s.x - r || y < s.y - r || x > s.x + s.w + r || y > s.y + s.h + r) return false;
  const pts = s.points;
  if (pts.length === 1) return Math.hypot(pts[0]![0] + s.x - x, pts[0]![1] + s.y - y) <= r;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1]![0] + s.x, ay = pts[i - 1]![1] + s.y, bx = pts[i]![0] + s.x, by = pts[i]![1] + s.y;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= r) return true;
  }
  return false;
}

// ------------------------------------------------------------ the line's shape

/**
 * A pen's stroke as a filled outline, wider where it was pressed harder: each point offset to either side by half
 * its width, along the line's normal, the two sides joined round at the ends.
 */
export function outline(points: Pt[], width: number): string {
  if (!points.length) return "";
  const rad = (p: Pt) => (width / 2) * (0.35 + 0.65 * Math.max(0.05, Math.min(1, p[2] || 0.5)));
  if (points.length === 1) {
    const [x, y] = points[0]!, r = rad(points[0]!);
    return `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
  }
  const left: [number, number][] = [], right: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    const r = rad(points[i]!), [x, y] = points[i]!;
    left.push([x + nx * r, y + ny * r]);
    right.push([x - nx * r, y - ny * r]);
  }
  /*
   * A curve through every point the pen gave (Catmull-Rom, as cubic Béziers): smooth, as a hand's line is, but
   * through the points themselves, not cutting the corners as the old curve through the midpoints did — so the
   * stroke settles as Supernote's own pen drew it while it was written. (Straight lines between the points were
   * tried, 2026-11-24: the page hears the pen only about once a frame, so they came out as visible corners.)
   */
  const smooth = (pts: [number, number][]) => {
    let d = "";
    const f = (n: number) => n.toFixed(1);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += `C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`;
    }
    return d;
  };
  const last = points.length - 1;
  const back = [...right].reverse();
  /*
   * A round cap: a half circle from one side to the other, bulging out past the stroke's end — drawn with two
   * curves through the point straight ahead, not an arc, whose way round depended on the stroke's direction and
   * so went inward at one end or the other, leaving a bite out of it unfilled.
   */
  const cap = (at: number, from: [number, number], to: [number, number]) => {
    const c = points[at]!;
    // Outward: from the nearest point that isn't the same one, toward this end.
    let o = at;
    do o += at === 0 ? 1 : -1; while (o > 0 && o < last && Math.hypot(points[o]![0] - c[0], points[o]![1] - c[1]) < 1e-6);
    let tx = c[0] - points[o]![0], ty = c[1] - points[o]![1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const r = rad(c), k = 0.5523 * r;
    const ahead: [number, number] = [c[0] + tx * r, c[1] + ty * r];
    // The side directions, as the points themselves lie (so either turn is right).
    const ax = (from[0] - c[0]) / (r || 1), ay = (from[1] - c[1]) / (r || 1);
    const f = (n: number) => n.toFixed(1);
    return `C${f(from[0] + tx * k)},${f(from[1] + ty * k)} ${f(ahead[0] + ax * k)},${f(ahead[1] + ay * k)} ${f(ahead[0])},${f(ahead[1])}`
      + `C${f(ahead[0] - ax * k)},${f(ahead[1] - ay * k)} ${f(to[0] + tx * k)},${f(to[1] + ty * k)} ${f(to[0])},${f(to[1])}`;
  };
  return `M${left[0]![0].toFixed(1)},${left[0]![1].toFixed(1)}` + smooth(left)
    + cap(last, left[last]!, right[last]!)
    + smooth(back)
    + cap(0, right[0]!, left[0]!) + "Z";
}

/** A highlighter's stroke: one even line through the points, smoothed. */
export function centerline(points: Pt[]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0]![0]},${points[0]![1]}l0.01,0`;
  let d = `M${points[0]![0].toFixed(1)},${points[0]![1].toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i]![0] + points[i + 1]![0]) / 2, my = (points[i]![1] + points[i + 1]![1]) / 2;
    d += `Q${points[i]![0].toFixed(1)},${points[i]![1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const last = points[points.length - 1]!;
  return d + `L${last[0].toFixed(1)},${last[1].toFixed(1)}`;
}
