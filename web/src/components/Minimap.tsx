// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
//
// The canvas in small, in its lower left corner: everything on it — cards and
// notes, regions, ink — and the part on screen as a frame. A press or a drag on
// it brings the view there. Opened and closed by its corner button, as each
// machine likes it (its own pan and zoom are each machine's too, so what was
// drawn on another can lie off screen — the map shows it).

import { useEffect, useReducer, useRef, useState } from "react";
import { Map as MapIcon, X } from "lucide-react";
import { inkOf } from "../api.ts";
import { centerline, onInk, paint } from "../ink.ts";

type Rect = { x: number; y: number; w: number; h: number };
type View = { x: number; y: number; z: number };

// Supercanvas: closed until opened (the map button, bottom right), and remembered after. A key of its own, so a
// map left open by an earlier build starts closed too.
const KEPT = "supercanvas.minimap";

/** A button's action on the press lifting (pen, finger or mouse), or Enter / Space. */
function press(act: () => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onPointerUp: (e: React.PointerEvent) => { e.stopPropagation(); e.preventDefault(); act(); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } },
  };
}
/** The map's size on screen, at most. */
const MAP_W = 200, MAP_H = 140;

export function Minimap({ boxes, regions, view, setView, wrap }: {
  boxes: Rect[];
  regions: Rect[];
  view: View;
  setView: (v: View) => void;
  wrap: React.RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(KEPT) === "open"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(KEPT, open ? "open" : "closed"); } catch { /* private */ }
  }, [open]);
  // Ink drawn or rubbed out: drawn again.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onInk(redraw), []);
  const dragging = useRef(false);

  if (!open) {
    return (
      // Acts as the pen (or finger) lifts, not on the "click" after it: on the Nomad a pen tap here didn't
      // always come through as one. Enter or Space for a keyboard.
      <button className="cv-minimap-open" title="Show the map" {...press(() => setOpen(true))}>
        <MapIcon size={15} />
      </button>
    );
  }

  const box = wrap.current?.getBoundingClientRect();
  const sw = box?.width ?? 800, sh = box?.height ?? 600;
  // What is on screen, in the canvas's units.
  const seen: Rect = { x: -view.x / view.z, y: -view.y / view.z, w: sw / view.z, h: sh / view.z };
  const ink = inkOf();
  const all = [...boxes, ...regions, ...ink.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })), seen];
  const x0 = Math.min(...all.map((r) => r.x)), y0 = Math.min(...all.map((r) => r.y));
  const x1 = Math.max(...all.map((r) => r.x + r.w)), y1 = Math.max(...all.map((r) => r.y + r.h));
  const pad = Math.max(x1 - x0, y1 - y0) * 0.05 + 20;
  const world = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  const scale = Math.min(MAP_W / world.w, MAP_H / world.h);
  const mw = Math.max(60, world.w * scale), mh = Math.max(40, world.h * scale);

  // A press on the map: the view brought so that point is in its middle.
  const goTo = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = world.x + ((e.clientX - r.left) / r.width) * world.w;
    const py = world.y + ((e.clientY - r.top) / r.height) * world.h;
    setView({ x: sw / 2 - px * view.z, y: sh / 2 - py * view.z, z: view.z });
  };
  const thin = 1.2 / scale;

  return (
    <div className="cv-minimap" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <svg
        width={mw}
        height={mh}
        viewBox={`${world.x} ${world.y} ${world.w} ${world.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); goTo(e); }}
        onPointerMove={(e) => { if (dragging.current) goTo(e); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
      >
        {regions.map((r, i) => (
          <rect key={`r${i}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={6 / scale} className="cv-minimap-region" style={{ strokeWidth: thin }} />
        ))}
        {boxes.map((r, i) => (
          <rect key={`b${i}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={3 / scale} className="cv-minimap-box" />
        ))}
        {ink.map((s) => (
          <path key={s.id} transform={`translate(${s.x} ${s.y})`} d={centerline(s.points)}
            style={{ fill: "none", stroke: paint(s.color), strokeWidth: Math.max(s.width, thin * 1.5), opacity: s.tool === "highlighter" ? 0.4 : 0.9 }}
            strokeLinecap="round" strokeLinejoin="round" />
        ))}
        <rect x={seen.x} y={seen.y} width={seen.w} height={seen.h} className="cv-minimap-view" style={{ strokeWidth: thin * 1.5 }} />
      </svg>
      <button className="cv-minimap-close" title="Hide the map" {...press(() => setOpen(false))}><X size={14} /></button>
    </div>
  );
}
