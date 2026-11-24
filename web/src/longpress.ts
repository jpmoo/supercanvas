// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
/*
 * Long-press is right-click.
 *
 * Every menu on the canvas — a node's (colors, shapes, mind-map children),
 * a link's, a region's, the canvas's own — opens on `contextmenu`, which a
 * desktop gets from the right button. A tablet has no right button, so a
 * finger or the pen held still for a moment sends one at that spot.
 *
 * Not while an ink tool is in hand: then holding the pen still is drawing a dot.
 */
const HOLD_MS = 550;
const SLOP = 10;

let timer: number | null = null;
let start: { x: number; y: number; id: number } | null = null;
let firedAt = 0;

function cancel() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  start = null;
}

addEventListener("pointerdown", (e) => {
  cancel();
  if (e.pointerType === "mouse" || !e.isPrimary) return;
  if (document.documentElement.dataset.ink) return;
  const target = e.target as Element;
  // Inside a note being written in, a long-press is the editor's (select a word).
  // Nor on a grip (a line's bend, a corner): holding one still is about to drag it.
  if (target.closest?.(".cm-editor, input, textarea, .files-panel, .pick-panel, .tools, .cv-bend-hit, .cv-corner")) return;
  start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  timer = window.setTimeout(() => {
    timer = null;
    if (!start) return;
    const at = document.elementFromPoint(start.x, start.y) ?? target;
    firedAt = performance.now();
    at.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: start.x, clientY: start.y, button: 2, buttons: 0,
    }));
    start = null;
  }, HOLD_MS);
}, true);

addEventListener("pointermove", (e) => {
  if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) cancel();
}, true);
addEventListener("pointerup", cancel, true);
addEventListener("pointercancel", cancel, true);

/*
 * A menu just opened by a long-press must not be shut by the same press
 * lifting (a click on the canvas closes menus), nor opened twice by the
 * system's own long-press arriving late.
 */
addEventListener("click", (e) => {
  if (performance.now() - firedAt < 700) { e.stopPropagation(); e.preventDefault(); }
}, true);
addEventListener("contextmenu", (e) => {
  if (e.isTrusted && performance.now() - firedAt < 900) { e.stopPropagation(); e.preventDefault(); }
}, true);

/*
 * Double-tap is double-click.
 *
 * A note opens for writing on `dblclick`, which the Nomad's WebView never
 * sends for two taps of the pen or a finger — only the two clicks. So two
 * clicks close together in time and place, from a pen or finger, are sent on
 * as a `dblclick` at that spot. A mouse makes its own.
 */
const TAP_GAP_MS = 400;
const TAP_SLOP = 24;
let lastTap: { t: number; x: number; y: number } | null = null;
let tapKind = "";
addEventListener("pointerdown", (e) => { tapKind = e.pointerType; }, true);
addEventListener("click", (e) => {
  if (!e.isTrusted || tapKind === "mouse") return;
  const now = performance.now();
  const prev = lastTap;
  lastTap = { t: now, x: e.clientX, y: e.clientY };
  if (!prev || now - prev.t > TAP_GAP_MS || Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > TAP_SLOP) return;
  lastTap = null;
  const target = e.target as Element;
  if (target.closest?.(".cm-editor, input, textarea, button, .files-panel, .pick-panel, .tools")) return;
  target.dispatchEvent(new MouseEvent("dblclick", {
    bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 0, detail: 2,
  }));
}, true);
