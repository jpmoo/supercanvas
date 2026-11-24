// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
/*
 * The tool strip: what you put on the canvas, and where it goes.
 *
 * The Mac's, ported rather than invented — `CanvasToolStrip` in
 * `CanvasSurface.swift`. Four tools, each **dragged** onto the surface rather
 * than clicked: a tool that adds something in the middle of the screen is a tool
 * you then have to move, and on a canvas the placing *is* the work.
 *
 * Talaria's own code, not part of the fork. Hermes has no tool strip — it fills
 * a canvas from a collection — so there is nothing here to keep in step with it,
 * and the strip writes through the same seam everything else does.
 *
 * Where a drop lands is read off the canvas's own transform. The layer carries
 * `translate(x, y) scale(z)`, which is the only place the view's pan and zoom
 * are written down, so a screen point becomes a document point without this
 * having to know anything else about the surface it sits on.
 */
import { useEffect, useRef, useState } from "react";
import { Eraser, FolderOpen, Highlighter, Image as ImageIcon, Lasso, Network, PenLine, Pointer, Redo2, SquareDashed, Type, Undo2, X } from "lucide-react";
import { chooseColor, chooseSize, chooseTool, inkState, INK_COLORS, INK_SIZES, onInk, resolveColor, setFingerDraws, setInk } from "../ink.ts";
import { CustomColor } from "./CustomColor.tsx";
import { canRedo as canRedoAll, canUndo as canUndoAll, document_, keepResized, onHistory, redo as redoAll, undo as undoAll } from "../api.ts";
import { choosePicture } from "../store.ts";
import { putDocument, type CanvasItem } from "../document.ts";
import { newMap } from "../mindmap.ts";

/** The six the format has, in the Mac's order. */
/*
 * The shapes, in the renderer's own names.
 *
 * This list used to carry `roundedRectangle` and `plain`, and `CanvasView` has
 * never heard of either: its vocabulary is an absent shape for the rounded
 * default, then `rectangle`, `ellipse`, `triangle` and `postIt`. A node dropped
 * as a "roundedRectangle" matched no rule at all and fell through to the sticky
 * styling underneath — which is how choosing Rounded produced a post-it.
 *
 * `""` is the absent one. It is stored as `null`, because that is what the
 * document says and what every reader of it expects.
 */
const SHAPES: { key: string; name: string }[] = [
  // Words on the canvas and nothing else. It is a real value in the document —
  // a picture is placed as one, meaning no paper behind and no line around —
  // and it differs from the rounded default only in wearing no border, which is
  // what `defaults` gives it.
  { key: "plain", name: "Plain text" },
  { key: "", name: "Rounded" },
  { key: "rectangle", name: "Rectangle" },
  { key: "ellipse", name: "Ellipse" },
  { key: "triangle", name: "Triangle" },
  { key: "postIt", name: "Post-it" },
];

/** A small drawing of a shape, for the button that will drop it. */
function ShapeMark({ shape }: { shape: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6 } as const;
  // Plain text wears the letter it is, which is also the glyph this button had
  // before it started showing shapes.
  if (shape === "plain") return <Type size={15} />;
  if (shape === "ellipse") return <svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="6" {...common} /></svg>;
  if (shape === "triangle") return <svg viewBox="0 0 16 16" width="15" height="15"><path d="M8 2.2 14 13.4H2z" {...common} strokeLinejoin="round" /></svg>;
  if (shape === "rectangle") return <svg viewBox="0 0 16 16" width="15" height="15"><rect x="2" y="3" width="12" height="10" {...common} /></svg>;
  if (shape === "postIt") {
    return (
      <svg viewBox="0 0 16 16" width="15" height="15">
        <path d="M2.5 3h11v6.5L10 13H2.5z" {...common} strokeLinejoin="round" />
        <path d="M13.5 9.5H10V13" {...common} strokeLinejoin="round" />
      </svg>
    );
  }
  return <svg viewBox="0 0 16 16" width="15" height="15"><rect x="2" y="3" width="12" height="10" rx="3" {...common} /></svg>;
}

/** What the daemon gives a shape when nobody has said otherwise. */
function defaults(shape: string): { fill: string | null; strokeWidth: number } {
  if (shape === "postIt") return { fill: "#fdf3b6", strokeWidth: 0 };
  // Zero is not the same as unset here — `borderOf` reads an explicit zero as
  // "no border" and an absent one as "whatever the stylesheet says". Plain text
  // means the first.
  if (shape === "plain") return { fill: null, strokeWidth: 0 };
  // Talaris: a shape comes in filled, so it reads as a thing on the canvas
  // rather than a loose outline. The fill is the theme's, named rather than
  // written as a color, so a light theme gets a light card; `readableOn` sees
  // no hex in it and leaves the ink to the stylesheet's text.
  return { fill: "var(--shape-fill)", strokeWidth: 1.5 };
}

const id = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A screen point, in document coordinates. */
function atPoint(clientX: number, clientY: number): { x: number; y: number } {
  const layer = window.document.querySelector<HTMLElement>(".cv-layer");
  const wrap = window.document.querySelector<HTMLElement>(".cv-wrap");
  const box = wrap?.getBoundingClientRect();
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(
    layer?.style.transform ?? "",
  );
  const [px, py, z] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 1];
  const left = (clientX - (box?.left ?? 0) - px) / z;
  const top = (clientY - (box?.top ?? 0) - py) / z;
  return { x: Math.round(left), y: Math.round(top) };
}


export function CanvasTools({ title, onPlaced, onFiles }: { title: string; onPlaced: () => void | Promise<void>; onFiles: () => void }) {
  const [shape, setShape] = useState("postIt");
  const [shapesOpen, setShapesOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  /*
   * The Select tool: a mode rather than an action.
   *
   * The Mac calls it "a mode tool that is currently on" and leaves it on until
   * it is turned off, which is what makes it worth having — arming it once and
   * sweeping three groups is the gesture; a tool that disarmed itself after one
   * would be a worse shift key.
   *
   * The flag lives on the root because the canvas is a sibling of this strip,
   * not a child of it, and a dataset attribute is the one channel both can see
   * without either owning the other.
   */
  const [selecting, setSelecting] = useState(false);
  // Drawn round what is to be chosen (a lasso) or swept as a box: kept for next time.
  const [selectBy, setSelectBy] = useState<"lasso" | "box">(() => {
    try { return localStorage.getItem("supercanvas.selectBy") === "box" ? "box" : "lasso"; } catch { return "lasso"; }
  });
  const chooseSelectBy = (by: "lasso" | "box") => {
    setSelectBy(by);
    try { localStorage.setItem("supercanvas.selectBy", by); } catch { /* private */ }
  };
  // Ink (ink.ts): its tool, color and size, drawn again as they change.
  const [, inkChanged] = useState(0);
  useEffect(() => onInk(() => inkChanged((n) => n + 1)), []);
  // Undo and redo light up as there comes to be something to undo or redo.
  useEffect(() => onHistory(() => inkChanged((n) => n + 1)), []);
  const ink = inkState();
  // The ink bar put out of the way, the pen still drawing: the pen's button brings it back.
  const [inkBarTucked, setInkBarTucked] = useState(false);
  useEffect(() => {
    if (selecting) window.document.documentElement.dataset.select = selectBy;
    else delete window.document.documentElement.dataset.select;
  }, [selecting, selectBy]);
  useEffect(() => {
    const off = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelecting(false);
    };
    addEventListener("keydown", off);
    return () => removeEventListener("keydown", off);
  }, []);

  /** Write one item into the document and tell the page to read it again. */
  async function place(item: CanvasItem) {
    const doc = document_();
    doc.items = [...doc.items, item];
    await putDocument(doc);
    // Awaited, so whoever placed it can act on the node once it is drawn.
    await onPlaced();
  }

  /*
   * A double-click on bare canvas drops one too, in whatever shape is selected.
   *
   * Asked for rather than duplicated. The canvas is a sibling of this strip and
   * neither owns the other — the same standing the Select mode has, which uses a
   * dataset flag on the root for exactly that reason. An event is the same idea
   * pointed the other way: the canvas says where, and the strip, which is the
   * thing that knows what a new node is, makes it. Copying `defaults` over there
   * would have been a second answer to that question, free to drift.
   */
  useEffect(() => {
    const drop = (e: Event) => {
      const at = (e as CustomEvent<{ x: number; y: number }>).detail;
      if (at) dropText(at.x, at.y);
    };
    window.document.addEventListener("talaria-drop-text", drop);
    return () => window.document.removeEventListener("talaria-drop-text", drop);
  });

  /** The root of a mind map (mindmap.ts), in a map's own look, to be written in at once. */
  function dropMind(clientX: number, clientY: number) {
    const at = atPoint(clientX, clientY);
    const root = newMap(at.x, at.y);
    void place(root).then(() => {
      window.document.dispatchEvent(new CustomEvent("talaris-edit-node", { detail: { id: root.id } }));
    });
  }

  function dropText(clientX: number, clientY: number) {
    const at = atPoint(clientX, clientY);
    const { fill, strokeWidth } = defaults(shape);
    const made = id();
    void place({
      id: made,
      x: at.x - 110, y: at.y - 65, w: 220, h: 130,
      // The rounded default is an *absent* key, not a value — `canvas.json` says
      // so and `document.ts` reads it that way. Writing a name for the default
      // would put a shape in the file that nothing there has ever meant.
      text: "", ...(shape ? { shape } : {}), fill, strokeWidth,
    }).then(() => {
      // Talaris: a new note is placed to be written in, so the canvas opens it
      // at once — told by event, for the same sibling reason as the drop.
      window.document.dispatchEvent(new CustomEvent("talaris-edit-node", { detail: { id: made } }));
    });
  }

  /** A picture, chosen from the device, placed in the middle of the view. */
  async function addPicture() {
    const file = await choosePicture();
    if (!file) return;
    const kept = await keepResized(file);
    const box = window.document.querySelector(".cv-wrap")?.getBoundingClientRect();
    const at = atPoint((box?.left ?? 0) + (box?.width ?? 900) / 2, (box?.top ?? 0) + (box?.height ?? 600) / 2);
    await place({
      id: id(),
      x: at.x - Math.round(kept.w / 2), y: at.y - Math.round(kept.h / 2), w: kept.w, h: kept.h,
      image: kept.name, images: [kept.name], showImage: true,
      // A picture is the node: no paper behind it and no line around it.
      shape: "plain", fill: null, strokeWidth: 0,
    });
  }

  const dropAt = (key: string, clientX: number, clientY: number) => {
    if (key === "text") dropText(clientX, clientY);
    else if (key === "mind") dropMind(clientX, clientY);
  };

  const tool = (key: string, title: string, node: React.ReactNode, onClick?: () => void) => (
    <button
      key={key}
      className={`tool${dragging === key ? " lifted" : ""}`}
      title={title}
      onClick={onClick}
      // Dragged onto the surface, in the Mac's own words: the placing is the
      // work. A plain click still drops one in the middle, for a pointer that
      // would rather not drag.
      onPointerDown={(e) => {
        if ((key !== "text" && key !== "mind") || e.button !== 0) return;
        e.preventDefault();
        setDragging(key);
        const finish = (up: PointerEvent) => {
          window.removeEventListener("pointerup", finish);
          setDragging(null);
          const over = window.document.elementFromPoint(up.clientX, up.clientY);
          if (over?.closest(".cv-wrap")) dropAt(key, up.clientX, up.clientY);
        };
        window.addEventListener("pointerup", finish);
      }}
    >
      {node}
    </button>
  );


  return (
    <div className="tools">
      {/* The canvas's name, first in the bar and taking what room is left (cut short with "…"); tapping it opens
          the canvases, as the folder button does. */}
      <button className="sc-title" title={title} onClick={onFiles}><span>{title}</span></button>
      {tool("files", "Canvases: open, new, rename", <FolderOpen size={15} />, onFiles)}
      <div className="tool-row">
        {/*
          * One button, and it is a picture of what it will drop.
          *
          * There were two: a `Type` glyph you dragged, and a chevron beside it
          * that opened the list. Which meant the tool never showed what it was
          * about to make, and the list was a second target the width of a
          * thumbnail. Now the button wears the shape — drag it to place one,
          * click it to choose a different one — and there is nothing to aim at
          * twice.
          */}
        {tool(
          "text",
          `Drag onto the canvas — ${SHAPES.find((s) => s.key === shape)?.name}`,
          <ShapeMark shape={shape} />,
          // Its strip across the top, or away again; the pen's goes away while it's out.
          () => setShapesOpen((o) => { if (!o) { setInkBarTucked(true); setSelecting(false); } return !o; }),
        )}
      </div>
      {shapesOpen && (
        // The shapes, as a strip across the top (Supercanvas): open until the shape button is pressed again or
        // its X. Choosing one doesn't close it — it is the shape the button drops from then on.
        <div className="tool-menu tool-strip shape-row" role="toolbar" aria-label="Shapes">
          {SHAPES.map((s) => (
            <button
              key={s.key}
              className={`shape-pick${shape === s.key ? " on" : ""}`}
              title={s.name}
              aria-label={s.name}
              onClick={() => setShape(s.key)}
            >
              <ShapeMark shape={s.key} />
            </button>
          ))}
          <span className="strip-gap" />
          <button className="ink-pick strip-close" title="Close" aria-label="Close" onClick={() => setShapesOpen(false)}><X size={15} /></button>
        </div>
      )}

      {tool("mind", "Drag onto the canvas — a mind map", <Network size={15} />, () => {
        const box = window.document.querySelector(".cv-wrap")?.getBoundingClientRect();
        dropMind((box?.left ?? 0) + (box?.width ?? 800) / 2, (box?.top ?? 0) + (box?.height ?? 600) / 2);
      })}
      <button
        className={`tool${selecting ? " armed" : ""}`}
        title={selecting ? "Selecting — tap to stop" : "Select: draw a lasso or a box round things"}
        onClick={() => { setInk(false); setShapesOpen(false); setSelecting((on) => !on); }}
      >
        <SquareDashed size={15} />
      </button>
      {selecting && (
        // How to select, as a strip down the side like the pen's: a lasso or a box.
        <div className="tool-menu tool-strip select-bar" role="toolbar" aria-label="Select">
          <div className="ink-row">
            <button className={`ink-pick${selectBy === "lasso" ? " on" : ""}`} title="Lasso: draw a loop round things"
              aria-label="Lasso" onClick={() => chooseSelectBy("lasso")}><Lasso size={15} /></button>
            <button className={`ink-pick${selectBy === "box" ? " on" : ""}`} title="Box: drag a box over things"
              aria-label="Box" onClick={() => chooseSelectBy("box")}><SquareDashed size={15} /></button>
          </div>
          <span className="strip-gap" />
          <button className="ink-pick strip-close" title="Stop selecting" aria-label="Close"
            onClick={() => setSelecting(false)}><X size={15} /></button>
        </div>
      )}

      {/* Ink (ink.ts): the pen, the highlighter and the eraser, with a color and a width. The pen and the mouse
          draw; a finger still pans and zooms. */}
      <button
        className={`tool${ink.on ? " armed" : ""}`}
        title={ink.on ? (inkBarTucked ? "Drawing — show the pen's tools" : "Drawing — put the tools away (the pen keeps drawing)")
          : "Draw with the pen"}
        onClick={() => {
          if (selecting) setSelecting(false);
          // Off: on, with its tools. On: its tools out of the way, or back. Put down from the tools, or Escape.
          // Off: on, with its strip across the top. On: the strip away, or back (the pen stays in hand).
          if (!ink.on) { setInkBarTucked(false); setInk(true); setShapesOpen(false); }
          else setInkBarTucked((t) => { if (t) setShapesOpen(false); return !t; });
        }}
      >
        {/* The tool in hand, in its color: what the pen will do. */}
        <span className="ink-now">
          {ink.on && ink.tool === "highlighter" ? <Highlighter size={15} /> : ink.on && ink.tool === "eraser" ? <Eraser size={15} /> : <PenLine size={15} />}
          {ink.on && ink.tool !== "eraser" && <span className="ink-now-dot" style={{ background: resolveColor(ink.color) }} />}
        </span>
      </button>
      {ink.on && !inkBarTucked && (
        // The pen's tools as a strip across the top (Supercanvas): open until the pen button is pressed again
        // or its X; the pen stays in hand either way.
        <div className="tool-menu tool-strip ink-bar" role="toolbar" aria-label="Pen">
          <div className="ink-row">
            {([["pen", "Pen", <PenLine size={15} key="p" />], ["highlighter", "Highlighter", <Highlighter size={15} key="h" />],
              ["eraser", "Eraser — touch a stroke to take it off", <Eraser size={15} key="e" />]] as const).map(([key, name, icon]) => (
              <button key={key} className={`ink-pick${ink.tool === key ? " on" : ""}`} title={name} aria-label={name}
                onClick={() => chooseTool(key)}>{icon}</button>
            ))}
          </div>
          <div className="ink-row ink-colors">
            {INK_COLORS.map((c) => (
              <button key={c} className={`ink-swatch${ink.color === c ? " on" : ""}`} title={c === "text" ? "The text's color" : c}
                style={{ background: resolveColor(c) }} onClick={() => chooseColor(c)} />
            ))}
            <CustomColor value={INK_COLORS.includes(ink.color) ? null : ink.color} onPick={(c) => chooseColor(c)} title="Another color…" />
          </div>
          <div className="ink-row">
            {[0, 1, 2, 3, 4].map((i) => {
              const w = INK_SIZES[ink.tool === "highlighter" ? "highlighter" : "pen"][i]!;
              return (
                <button key={i} className={`ink-pick${ink.size === i ? " on" : ""}`} title={["Fine", "Medium", "Broad", "Thick", "Heavy"][i]}
                  onClick={() => chooseSize(i)}>
                  <span className="ink-dot" style={{ width: Math.min(20, 3 + w / 2), height: Math.min(20, 3 + w / 2),
                    background: resolveColor(ink.color), opacity: ink.tool === "highlighter" ? 0.5 : 1 }} />
                </button>
              );
            })}
          </div>
          <div className="ink-row">
            <button className={`ink-pick${ink.finger ? " on" : ""}`}
              title={ink.finger ? "A finger draws (two fingers pan and zoom) — tap to pan with a finger instead" : "A finger pans — tap to draw with a finger too"}
              aria-pressed={ink.finger} onClick={() => setFingerDraws(!ink.finger)}><Pointer size={15} /></button>
          </div>
          <span className="strip-gap" />
          <button className="ink-pick strip-close" title="Close (the pen stays in hand)" aria-label="Close"
            onClick={() => setInkBarTucked(true)}><X size={15} /></button>
        </div>
      )}

      {tool("image", "A picture from the device", <ImageIcon size={15} />, () => void addPicture())}
      {/* The view's own controls (lock, background, zoom, clear) follow, after a divider: CanvasView puts its
          bar here (a portal into #sc-viewbar), so the top right is one toolbar. */}
      {/* Undo and redo: the whole canvas's (api.ts), whatever the change — ink, notes, links, moves. */}
      <span className="cv-tb-sep tools-sep" />
      <button className="tool" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndoAll()} onClick={() => undoAll()}><Undo2 size={15} /></button>
      <button className="tool" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedoAll()} onClick={() => redoAll()}><Redo2 size={15} /></button>
      <span className="cv-tb-sep tools-sep" />
      <div id="sc-viewbar" className="sc-viewbar" />
    </div>
  );
}
