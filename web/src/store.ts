// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
/*
 * Where canvases live: one folder, one file per canvas.
 *
 * On the Nomad the folder is the one picked through Android's folder picker,
 * reached through the `SC` bridge that `MainActivity.java` adds to the page.
 * In a desktop browser (for working on the app itself) there is no bridge, so
 * the same calls are answered from `localStorage` — a stand-in folder that
 * lives in the browser. Nothing above this module knows which one it has.
 *
 * Paths are relative to the folder and "/"-separated: "Projects/Garden.supercanvas".
 */

export const EXT = ".supercanvas";

export interface Entry {
  name: string;
  dir: boolean;
  mtime: number;
}

interface Bridge {
  hasFolder(): boolean;
  folderName(): string;
  pickFolder(): void;
  list(path: string): string;
  read(path: string): string | null;
  write(path: string, text: string): boolean;
  mkdir(path: string): boolean;
  trash(path: string): string | null;
  remove(path: string): boolean;
  rename(path: string, newName: string): boolean;
  setOrientation?(o: string): void;
  hasStorage?(): boolean;
  askStorage?(): void;
  storageRoot?(): string;
  folderPath?(): string;
  browse?(abs: string): string;
  useFolder?(abs: string): boolean;
  makeFolder?(abs: string, name: string): boolean;
  picture?(abs: string, edge: number): string | null;
  systemPicture?(): void;
  showKeyboard?(): void;
  einkMode?(dataMode: number, showMode: number): boolean;
  einkReset?(): void;
}

const bridge = (window as unknown as { SC?: Bridge }).SC ?? null;
export const onDevice = bridge !== null;

/* ---------------------------------------------------------- browser fallback */

const LS = "supercanvas.fs.";
const browser: Bridge = {
  hasFolder: () => true,
  folderName: () => "Browser storage",
  pickFolder: () => {},
  list(path) {
    const prefix = path ? path + "/" : "";
    const seen = new Map<string, Entry>();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (!key.startsWith(LS)) continue;
      const rel = key.slice(LS.length);
      if (!rel.startsWith(prefix)) continue;
      const rest = rel.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash >= 0) {
        const name = rest.slice(0, slash);
        if (!seen.has(name)) seen.set(name, { name, dir: true, mtime: 0 });
      } else if (rest && rest !== ".dir") {
        let mtime = 0;
        try { mtime = JSON.parse(localStorage.getItem(key) || "{}").__mtime ?? 0; } catch { /* fine */ }
        seen.set(rest, { name: rest, dir: false, mtime });
      }
    }
    return JSON.stringify([...seen.values()]);
  },
  read: (path) => localStorage.getItem(LS + path),
  write(path, text) {
    try {
      localStorage.setItem(LS + path, text);
      return true;
    } catch {
      return false;
    }
  },
  mkdir(path) {
    localStorage.setItem(LS + path + "/.dir", "");
    return true;
  },
  trash(path) {
    localStorage.removeItem(LS + path);
    return path;
  },
  remove(path) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)!;
      if (key === LS + path || key === LS + path + "/.dir") localStorage.removeItem(key);
    }
    return true;
  },
  rename(path, newName) {
    const text = localStorage.getItem(LS + path);
    if (text === null) return false;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    if (localStorage.getItem(LS + parent + newName) !== null) return false;
    localStorage.setItem(LS + parent + newName, text);
    localStorage.removeItem(LS + path);
    return true;
  },
};

const fs: Bridge = bridge ?? browser;

/* ------------------------------------------------------------------- the api */

export const hasFolder = () => fs.hasFolder();
export const folderName = () => fs.folderName();
export const pickFolder = () => fs.pickFolder();
export const setOrientation = (o: string) => fs.setOrientation?.(o);

/** Folders and canvases directly inside `path`, folders first, then newest first. */
export function list(path = ""): Entry[] {
  let all: Entry[] = [];
  try {
    all = JSON.parse(fs.list(path)) as Entry[];
  } catch {
    return [];
  }
  return all
    .filter((e) => e.dir || e.name.toLowerCase().endsWith(EXT))
    .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.dir ? a.name.localeCompare(b.name) : b.mtime - a.mtime));
}

/** Every name directly inside `path`, whatever it is (for a new file's name not to clash). */
export function namesIn(path = ""): Set<string> {
  try {
    return new Set((JSON.parse(fs.list(path)) as Entry[]).map((e) => e.name.toLowerCase()));
  } catch {
    return new Set();
  }
}

export const read = (path: string) => fs.read(path);

export function write(path: string, text: string) {
  if (!fs.write(path, text)) throw new Error(`Could not save ${path}`);
}

export const mkdir = (path: string) => fs.mkdir(path);
/** Moved to the folder's hidden `.trash`, never erased. */
export const trash = (path: string) => fs.trash(path) !== null;
export const rename = (path: string, newName: string) => fs.rename(path, newName);

export const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
/** A canvas's name as shown: its file name without the extension. */
export const titleOf = (p: string) => nameOf(p).replace(/\.supercanvas$/i, "");

/** A file name nobody has used in `folder` yet, from `title`. */
export function freeName(folder: string, title: string): string {
  const clean = title.replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+/, "").trim() || "Untitled";
  const taken = new Set(list(folder).map((e) => e.name.toLowerCase()));
  let name = clean + EXT;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${clean} ${n}${EXT}`;
  return name;
}

/* ------------------------------------------------- the device's own storage
 * On the Nomad the app reads storage directly (MainActivity), so choosing a
 * folder and choosing a picture are the app's own screens (Pickers.tsx), each
 * with a way out — Android's own pickers had none on the Supernote.
 */
export interface Browsed {
  path: string;
  dirs: string[];
  images: { name: string; mtime: number }[];
}

/** Whether this is the device, with file access granted. */
export const canBrowse = () => Boolean(bridge?.browse && bridge.hasStorage?.());
/** Raise the device keyboard for the field just focused by script (no-op in a browser). */
export const showKeyboard = () => bridge?.showKeyboard?.();
/**
 * The Nomad's screen refresh while ink is in hand: fast black-and-white (data A2, show DU) so the line keeps up
 * with the pen, and the default back after. (MainActivity.einkMode; nothing elsewhere.)
 */
export function einkFast(on: boolean) {
  if (on) bridge?.einkMode?.(1, 1);
  else bridge?.einkReset?.();
}
export const askStorage = () => bridge?.askStorage?.();
export const storageRoot = () => bridge?.storageRoot?.() ?? "";
export const folderPath = () => bridge?.folderPath?.() ?? "";
export function browse(abs: string): Browsed {
  try {
    const b = JSON.parse(bridge?.browse?.(abs) ?? "{}") as Partial<Browsed>;
    return { path: b.path ?? abs, dirs: b.dirs ?? [], images: b.images ?? [] };
  } catch {
    return { path: abs, dirs: [], images: [] };
  }
}
export const useFolder = (abs: string) => bridge?.useFolder?.(abs) ?? false;
export const makeFolder = (abs: string, name: string) => bridge?.makeFolder?.(abs, name) ?? false;
/** A picture on the device, as a data URL no wider or taller than `edge`. */
export const pictureData = (abs: string, edge: number) => bridge?.picture?.(abs, edge) ?? null;

/*
 * The pickers are drawn by main.tsx; these ask for one and wait for its answer.
 */
type Ask = { kind: "folder" | "picture"; done: (value: string | null) => void };
let asker: ((a: Ask) => void) | null = null;
export const onPickerAsked = (f: (a: Ask) => void) => { asker = f; };
function ask(kind: Ask["kind"]): Promise<string | null> {
  return new Promise((done) => (asker ? asker({ kind, done }) : done(null)));
}

/** Choose where canvases are kept: the app's own folder chooser, or Android's where that is all there is. */
export async function chooseFolder(): Promise<void> {
  if (!bridge) return;
  if (!canBrowse()) return bridge.pickFolder();
  const abs = await ask("folder");
  if (abs && useFolder(abs)) (window as unknown as { sc?: { onFolder?: () => void } }).sc?.onFolder?.();
}

/** Android's own picture picker (for pictures in other apps), answered through `sc.picked`. */
let systemWaiter: ((d: string | null) => void) | null = null;
export function systemPicture(): Promise<string | null> {
  return new Promise((done) => {
    systemWaiter = done;
    bridge?.systemPicture?.();
  });
}
export function systemPicked(d: string | null) {
  const w = systemWaiter;
  systemWaiter = null;
  w?.(d);
}

/* ------------------------------------------------------- picking a picture
 * On the device: the app's own picture browser (a data URL comes back). In a
 * browser: an ordinary file input.
 */
export async function choosePicture(): Promise<Blob | null> {
  if (canBrowse()) {
    const d = await ask("picture");
    if (!d) return null;
    return fetch(d).then((r) => r.blob(), () => null);
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
