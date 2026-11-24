// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/*
 * The Nomad's WebView is old (no Play Store to update it), so newer CSS is
 * written the old way: `color-mix(...)` becomes the color carrying more of the
 * mix, and `inset` its four sides.
 */
function oldWebView(): Plugin {
  /** `color-mix(in srgb, A p%, B)` → whichever of A and B carries more weight. */
  const mixFirst = (v: string): string => {
    const at = v.indexOf("color-mix(");
    if (at < 0) return v;
    let depth = 0, end = at + 10;
    const args: string[] = [];
    let start = end;
    for (; end < v.length; end++) {
      const c = v[end];
      if (c === "(") depth++;
      else if (c === ")") { if (depth === 0) break; depth--; }
      else if (c === "," && depth === 0) { args.push(v.slice(start, end)); start = end + 1; }
    }
    args.push(v.slice(start, end));
    const part = (s = "") => {
      const m = /^(.*?)\s+(\d+(?:\.\d+)?)%\s*$/.exec(s.trim());
      return m ? { color: m[1].trim(), pct: Number(m[2]) } : { color: s.trim(), pct: NaN };
    };
    const a = part(args[1]), b = part(args[2]);
    const pa = !isNaN(a.pct) ? a.pct : !isNaN(b.pct) ? 100 - b.pct : 50;
    const chosen = mixFirst(pa >= 50 ? a.color : b.color);
    return mixFirst(v.slice(0, at) + chosen + v.slice(end + 1));
  };
  return {
    name: "old-webview",
    enforce: "post",
    generateBundle(_o, bundle) {
      for (const f of Object.values(bundle)) {
        if (f.type !== "asset" || !f.fileName.endsWith(".css")) continue;
        let css = String(f.source);
        // Replaced, not merely preceded by a fallback: a color-mix() holding a var() is only found wanting
        // once the var is filled in, and then the property falls to its default (a black minimap), not to
        // the line before.
        css = css.replace(/([{;])\s*([-\w]+)\s*:([^;{}]*color-mix\([^;{}]*)(?=[;}])/g, (_m, pre, prop, val) =>
          `${pre}${prop}:${mixFirst(val)}`);
        css = css.replace(/([{;])\s*inset\s*:\s*([^;{}]+)(?=[;}])/g, (_m, pre, val) => {
          const p = val.replace(/!important/, "").trim().split(/\s+/);
          const imp = /!important/.test(val) ? " !important" : "";
          const [t, r = t, b = t, l = r] = p;
          return `${pre}top:${t}${imp};right:${r}${imp};bottom:${b}${imp};left:${l}${imp}`;
        });
        f.source = css;
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), oldWebView(), viteSingleFile()],
  resolve: {
    alias: {
      "react-router-dom": "/src/shims/router.tsx",
      "@hermes/shared": "/src/shims/shared.ts",
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    target: "chrome80",
    cssTarget: "chrome80",
  },
});
