// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
/*
 * The app's own folder chooser and picture chooser.
 *
 * Android's pickers are other apps, and on the Supernote they offered no way
 * back out. These are drawn by the canvas itself, read the device's storage
 * through the bridge, and always have Cancel (and Back closes them).
 */
import { useEffect, useRef, useState } from "react";
import { ChevronUp, Folder, FolderPlus, X } from "lucide-react";
import * as store from "../store.ts";

const LAST_PICTURES = "supercanvas.pictureFolder";
const lastPictures = () => {
  try { return localStorage.getItem(LAST_PICTURES) || ""; } catch { return ""; }
};

function parentOf(abs: string, root: string) {
  if (abs === root || !abs.includes("/")) return root;
  const up = abs.slice(0, abs.lastIndexOf("/"));
  return up.length < root.length ? root : up;
}

/** A thumbnail, read from the device only once it is scrolled into view. */
function Thumb({ abs }: { abs: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      // Let the panel draw first; each thumbnail is a small trip to the device.
      setTimeout(() => setSrc(store.pictureData(abs, 220)), 0);
    }, { rootMargin: "200px" });
    seen.observe(node);
    return () => seen.disconnect();
  }, [abs]);
  return <div className="pick-thumb" ref={el}>{src ? <img src={src} alt="" /> : null}</div>;
}

export function Picker({ kind, done }: { kind: "folder" | "picture"; done: (value: string | null) => void }) {
  const root = store.storageRoot();
  const [path, setPath] = useState(() => {
    const start = kind === "picture" ? lastPictures() || store.folderPath() : store.folderPath() || `${root}/Document`;
    return start || root;
  });
  const [making, setMaking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, again] = useState(0);
  const listing = store.browse(path);
  const shown = listing.path;
  const rel = shown.startsWith(root) ? shown.slice(root.length).replace(/^\//, "") : shown;

  // Back closes the picker, as Cancel does.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") done(null); };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [done]);

  async function pick(name: string) {
    setBusy(true);
    const abs = `${shown}/${name}`;
    try { localStorage.setItem(LAST_PICTURES, shown); } catch { /* fine */ }
    // Read at a size worth keeping; keepResized makes it a node.
    setTimeout(() => done(store.pictureData(abs, 1600)), 0);
  }

  return (
    <div className="files-backdrop pick-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) done(null); }}>
      <div className="pick-panel" onKeyDown={(e) => e.stopPropagation()}>
        <div className="files-head">
          <span className="pick-title">{kind === "folder" ? "Where to keep canvases" : "Add a picture"}</span>
          <button className="files-icon" title="Cancel" onClick={() => done(null)}><X size={22} /></button>
        </div>
        <div className="pick-where">
          <button className="pick-up" disabled={shown === root} onClick={() => setPath(parentOf(shown, root))}>
            <ChevronUp size={18} /> Up
          </button>
          <span className="pick-path">{rel || "Device storage"}</span>
        </div>

        <div className="pick-list">
          {listing.dirs.map((d) => (
            <button key={d} className="files-row" onClick={() => setPath(`${shown}/${d}`)}>
              <Folder size={18} /> <span className="files-name">{d}</span>
            </button>
          ))}
          {kind === "picture" && listing.images.length > 0 && (
            <div className="pick-grid">
              {listing.images.map((im) => (
                <button key={im.name} className="pick-tile" disabled={busy} onClick={() => void pick(im.name)}>
                  <Thumb abs={`${shown}/${im.name}`} />
                  <span>{im.name}</span>
                </button>
              ))}
            </div>
          )}
          {!listing.dirs.length && !(kind === "picture" && listing.images.length) && (
            <div className="files-empty">{kind === "picture" ? "No pictures or folders here." : "No folders here."}</div>
          )}
        </div>

        {making !== null && (
          <form className="files-ask" onSubmit={(e) => {
            e.preventDefault();
            const n = making.trim();
            if (n && store.makeFolder(shown, n)) setPath(`${shown}/${n}`);
            setMaking(null);
            again((x) => x + 1);
          }}>
            <input autoFocus placeholder="Folder name" value={making} onChange={(e) => setMaking(e.target.value)} />
            <button type="submit">Make</button>
            <button type="button" onClick={() => setMaking(null)}>Cancel</button>
          </form>
        )}

        <div className="pick-foot">
          {kind === "folder" ? (
            <>
              <button onClick={() => setMaking("")}><FolderPlus size={16} /> New folder</button>
              <button className="primary" disabled={shown === root} onClick={() => done(shown)}>Use this folder</button>
            </>
          ) : (
            <button onClick={() => { setBusy(true); void store.systemPicture().then((d) => done(d)); }}>Other apps…</button>
          )}
          <button onClick={() => done(null)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
