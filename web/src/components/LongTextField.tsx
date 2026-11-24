// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore

/*
 * The text inside a canvas note — the same editor as a writing page.
 *
 * Talaris's Markdown editor (editor/), bundled in: Obsidian-style live
 * preview. Compact, because a note has no room for a fold margin or drag grips.
 */
import { useEffect, useRef } from "react";
import { createEditor } from "../editor/index.ts";
import { showKeyboard } from "../store.ts";

interface Field {
  text: string;
  set(next: string): void;
  /** Color the selected words, or the colored words round the caret (editor's setColor). */
  setColor?(color: string | null): boolean;
  readonly selecting?: boolean;
  focus(): void;
  destroy(): void;
}

/** The editor of the note whose field holds `el`, for the note's menu to color its words. */
export function fieldEditor(el: Element | null | undefined): Field | null {
  const host = el?.closest?.(".longtext") as (HTMLElement & { talarisField?: Field }) | null;
  return host?.talarisField ?? null;
}

export function LongTextField({
  value,
  onChange,
  placeholder = "Write…",
  autofocus = false,
  onFocusChange,
}: {
  value: unknown;
  onChange: (value: string) => void;
  placeholder?: string;
  blockId?: string;
  autofocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<Field | null>(null);
  const latest = useRef<(text: string) => void>(onChange);
  latest.current = onChange;

  useEffect(() => {
    let dead = false;
    const initial = typeof value === "string" ? value : "";
    void (async () => {
      if (dead || !host.current) return;
      field.current = createEditor(host.current, initial, {
        live: true,
        compact: true,
        onChange: (text: string) => latest.current(text),
        // Links open in the device's browser (MainActivity hands them on).
        onOpenUrl: (url: string) => window.open(url, "_blank"),
      }) as unknown as Field;
      // Found again from the menu (fieldEditor), by the element it lives in.
      (host.current as HTMLElement & { talarisField?: Field }).talarisField = field.current;
      // A note somebody has just made should take words without a click.
      // So should an empty note opened for writing (a new note, a new map
      // node): the canvas asks for focus too, but its request can land before
      // the re-read that draws the note settles, and be lost.
      const empty = !initial.trim() && host.current.closest("[data-editing]");
      if (autofocus || empty) {
        field.current.focus();
        setTimeout(() => { field.current?.focus(); showKeyboard(); }, 150);
      }
    })();
    return () => {
      dead = true;
      field.current?.destroy();
    };
    // Mounted once. `EphemeralNote` remounts this by key when the text changes
    // under it, which is how a note edited elsewhere catches up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="longtext"
      ref={host}
      data-placeholder={placeholder}
      // The canvas listens for keys everywhere — Delete removes a node — so
      // nothing typed in here may reach it.
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
    />
  );
}
