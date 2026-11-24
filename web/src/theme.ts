// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore

/*
 * The canvas, dressed for e-ink.
 *
 * Talaris's canvas took its values from the desktop's tokens.css. Here the
 * same names are given values for a black-and-white e-ink page: white paper,
 * black ink, gray rules, no shadows and nothing that moves. The forked
 * stylesheet speaks Hermes' palette (`--bg`, `--border`, …), so those names
 * are pointed at these, as Talaris did.
 */
import "./controls.css";

export function wearTheme(): void {
  document.documentElement.dataset.mode = "light";
  const style = document.createElement("style");
  style.textContent = `
    :root {
      --desk: #ffffff;
      --surface: #ffffff;
      --paper: #ffffff;
      --frame: #000000;
      --line: #9a9a9a;
      --text: #000000;
      --muted: #555555;
      --accent: #000000;
      --accent-wash: #e4e4e4;
      --accent-hover: #f0f0f0;
      --accent-strong: #cfcfcf;
      --accent-line: #000000;
      --danger: #000000;
      --danger-wash: #e4e4e4;
      --warn: #333333;
      --tint-1: #444; --tint-2: #555; --tint-3: #666; --tint-4: #777;
      --tint-5: #444; --tint-6: #555; --tint-7: #666; --tint-8: #777;
      --font: system-ui, "Roboto", sans-serif;
      --radius-panel: 10px;
      --radius-control: 8px;
      --radius-row: 5px;
      --radius-pill: 16px;
      /* Bigger than the desktop's: a finger and a pen, not a mouse. */
      --control: 40px;
      --control-float: 44px;
      --menu-shadow: none;
      --edge-shadow: none;
      --edge-shadow-up: none;
      --scrim: rgba(255, 255, 255, .6);
      --catch: rgba(0, 0, 0, .01);
      --disabled: .35;
      --done: .5;
      --dur: 0s;
      --ease: linear;
      --ease-exit: linear;
      --z-sheet: 50; --z-pop: 80; --z-tip: 90; --z-ghost: 999;

      /* Hermes' names, pointed at the ones above. */
      --bg: var(--desk);
      --surface-2: var(--paper);
      --text-muted: var(--muted);
      --text-faint: var(--muted);
      --text-secondary: var(--muted);
      --border: var(--line);
      --border-strong: #000000;
      --accent-ink: var(--text);
      --font-body: var(--font);
      --font-chrome: var(--font);
      --postit: #f4ecb8;
      --postit-edge: #8a8a8a;
      --shape-fill: #ffffff;
      --shadow-soft: none;
      --shadow-lift: none;
      --shadow-color: transparent;
    }
    html, body { background: #fff; overflow: hidden; margin: 0; height: 100%;
      overscroll-behavior: none; touch-action: none; }
    body { color: var(--text); font-family: var(--font); user-select: none; -webkit-user-select: none; }
    #canvas-root { height: 100%; }
    .cv-wrap, .cv-node, .cv-region, .tools, .tool-menu, .menu-item, .hint, .modal-card, .cv-zoom { font-family: var(--font) !important; }
    input, select, textarea, button { color: inherit; font-family: inherit; }
    .cv-region-title { font-family: var(--font); letter-spacing: 1px; color: var(--muted); }
    .cv-marquee { border: 2px dashed #000 !important; background: transparent !important; }

    /* The paper: dots, graph lines, or nothing — moving and scaling with the view. */
    .cv-wrap.paper-dots {
      background: radial-gradient(circle, #8a8a8a 1.2px, transparent 1.3px)
        var(--cv-x, 0px) var(--cv-y, 0px) / calc(28px * var(--cv-z, 1)) calc(28px * var(--cv-z, 1)), var(--cv-paper, #fff);
    }
    .cv-wrap.paper-lines {
      background:
        linear-gradient(to right, #c8c8c8 1px, transparent 1px)
          var(--cv-x, 0px) var(--cv-y, 0px) / calc(28px * var(--cv-z, 1)) calc(28px * var(--cv-z, 1)),
        linear-gradient(to bottom, #c8c8c8 1px, transparent 1px)
          var(--cv-x, 0px) var(--cv-y, 0px) / calc(28px * var(--cv-z, 1)) calc(28px * var(--cv-z, 1)),
        var(--cv-paper, #fff);
    }
    .cv-wrap.paper-none { background: var(--cv-paper, #fff); }
    .cv-note .cv-paper, .cv-note .md-editor { font-size: calc(15px * var(--type-scale, 1)) !important; }
    .cv-note:not([data-shape="postIt"]) .cv-paper { color: var(--text); }
    .cv-note:not([data-shape]) .cv-paper { border-radius: 12px; }
    .cv-note .cv-body > .longtext { flex: 0 1 auto !important; height: auto !important; min-height: 0; max-height: 100%; overflow: auto; }

    .modal-backdrop { background: var(--scrim) !important; backdrop-filter: none !important; }
    .modal-card { background: #fff !important; color: var(--text); border: 2px solid #000 !important;
      border-radius: var(--radius-panel) !important; box-shadow: none !important; font-family: var(--font); }
    .modal-title { font-weight: 600 !important; font-size: 13px !important; letter-spacing: 1px; text-transform: uppercase; color: #000 !important; }
    .modal-message { color: var(--muted) !important; }
    /* (The shapes' menu is a strip down the left now, placed by eink.css with the pen's.) */
    .cv-region-add { border-radius: var(--radius-row) !important; background: transparent !important; border: 1px solid var(--muted) !important; color: var(--muted) !important; }
    .cv-region-add.on { border-color: #000 !important; color: #000 !important; }
    .cv-menu-gap { width: 10px; display: inline-block; }
  `;
  document.head.append(style);
}
