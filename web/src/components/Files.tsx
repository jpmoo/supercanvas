// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
/*
 * The canvases in the folder: open one, make one, rename or delete this one.
 *
 * A panel down the left edge, big targets for a finger or the pen, no motion.
 * Folders inside the canvas folder can be opened and made, so a long list of
 * canvases can be filed.
 */
import { useState } from "react";
import { ChevronLeft, ChevronRight, FileDown, FilePlus, Folder, FolderPlus, Pencil, Trash2, X } from "lucide-react";
import { exportCanvas } from "../export.ts";
import { HOME, VERSION } from "../version.ts";
import * as store from "../store.ts";

export function Files({
  current,
  onOpen,
  onRenamed,
  onDeleted,
  onClose,
}: {
  current: string;
  onOpen: (path: string) => void;
  onRenamed: (path: string) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [folder, setFolder] = useState(store.parentOf(current));
  const [, refresh] = useState(0);
  const [asking, setAsking] = useState<null | { kind: "new" | "folder" | "rename"; value: string }>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const [orient, setOrient] = useState(() => store.orientation());
  const [exporting, setExporting] = useState(false);
  async function exportAs(kind: "png" | "pdf") {
    setError(null);
    setSaid(null);
    setExporting(true);
    const r = await exportCanvas(current, kind);
    setExporting(false);
    if (r.ok) { setSaid(r.message); refresh((n) => n + 1); } else setError(r.message);
  }
  const entries = store.list(folder);
  const join = (name: string) => (folder ? `${folder}/${name}` : name);
  const when = (t: number) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

  function submit() {
    if (!asking) return;
    const value = asking.value.trim();
    if (!value) return setAsking(null);
    setError(null);
    if (asking.kind === "new") {
      const name = store.freeName(folder, value);
      store.write(join(name), JSON.stringify({ format: 1, app: "supercanvas", items: [], links: [], regions: [] }));
      setAsking(null);
      onOpen(join(name));
    } else if (asking.kind === "folder") {
      if (!store.mkdir(join(value.replace(/[\\/]/g, "-")))) setError("Could not make that folder.");
      setAsking(null);
      refresh((n) => n + 1);
    } else {
      const name = value.replace(/[\\/:*?"<>|]/g, "-") + store.EXT;
      if (name === store.nameOf(current)) return setAsking(null);
      const parent = store.parentOf(current);
      if (store.rename(current, name)) {
        setAsking(null);
        onRenamed(parent ? `${parent}/${name}` : name);
      } else setError("Could not rename — is that name taken?");
    }
  }

  return (
    <div className="files-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="files-panel" onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}>
        <div className="files-head">
          <span className="files-folder">{store.folderName()}{folder ? ` / ${folder}` : ""}</span>
          <button className="files-icon" title="Close" onClick={onClose}><X size={20} /></button>
        </div>

        {about ? (
          <div className="files-about">
            <h2>Supercanvas</h2>
            <p className="files-about-version">Version {VERSION}</p>
            <p>
              An infinite canvas for the Supernote Nomad: notes, shapes, connections, simple mind maps, pictures and
              handwriting, with Supernote's own real-time pen engine for the ink.
            </p>
            <p>
              No sync and no accounts: each canvas is one <code>.supercanvas</code> file in the folder you chose,
              saved a moment after every change.
            </p>
            <dl>
              <dt>License</dt><dd>MIT — free to use, change and share.</dd>
              <dt>By</dt><dd>Jeff Moore, 2026</dd>
              <dt>Source</dt><dd><a href={HOME} target="_blank" rel="noreferrer">{HOME.replace("https://", "")}</a></dd>
              <dt>Built with</dt><dd>React, CodeMirror and Lucide icons (each under its own open-source license).</dd>
            </dl>
            <p className="files-about-note">
              A beta, tested on the Supernote Nomad only. The live ink uses undocumented parts of Supernote's
              firmware, so a firmware update could change how it behaves.
            </p>
            <div className="files-actions">
              <button onClick={() => setAbout(false)}><ChevronLeft size={16} /> Back</button>
            </div>
          </div>
        ) : (<>
        <div className="files-current">
          <div className="files-current-name">{store.titleOf(current)}</div>
          <div className="files-actions">
            <button onClick={() => setAsking({ kind: "rename", value: store.titleOf(current) })}><Pencil size={16} /> Rename</button>
            <button onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Delete</button>
          </div>
          {/* The whole canvas as a picture, saved beside it (export.ts). */}
          <div className="files-actions">
            <button disabled={exporting} onClick={() => void exportAs("png")}><FileDown size={16} /> Export PNG</button>
            <button disabled={exporting} onClick={() => void exportAs("pdf")}><FileDown size={16} /> Export PDF</button>
          </div>
          {confirmDelete && (
            <div className="files-confirm">
              Move “{store.titleOf(current)}” to the folder’s .trash?
              <div className="files-actions">
                <button onClick={() => {
                  if (store.trash(current)) onDeleted();
                  else setError("Could not delete it.");
                  setConfirmDelete(false);
                }}>Delete</button>
                <button onClick={() => setConfirmDelete(false)}>Keep</button>
              </div>
            </div>
          )}
        </div>

        <div className="files-actions files-make">
          <button onClick={() => setAsking({ kind: "new", value: "" })}><FilePlus size={16} /> New canvas</button>
          <button onClick={() => setAsking({ kind: "folder", value: "" })}><FolderPlus size={16} /> New folder</button>
        </div>

        {asking && (
          <form className="files-ask" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <input
              autoFocus
              placeholder={asking.kind === "folder" ? "Folder name" : "Canvas name"}
              value={asking.value}
              onChange={(e) => setAsking({ ...asking, value: e.target.value })}
            />
            <button type="submit">{asking.kind === "rename" ? "Rename" : "Make"}</button>
            <button type="button" onClick={() => setAsking(null)}>Cancel</button>
          </form>
        )}
        {error && <div className="files-error">{error}</div>}
        {said && <div className="files-said">{said}</div>}

        <div className="files-list">
          {folder && (
            <button className="files-row" onClick={() => setFolder(store.parentOf(folder))}>
              <ChevronLeft size={18} /> <span className="files-name">Back</span>
            </button>
          )}
          {entries.map((e) => {
            const p = join(e.name);
            return (
              <button
                key={e.name}
                className={`files-row${p === current ? " on" : ""}`}
                onClick={() => (e.dir ? setFolder(p) : onOpen(p))}
              >
                {e.dir && <Folder size={18} />}
                <span className="files-name">{e.dir ? e.name : store.titleOf(e.name)}</span>
                {!e.dir && <span className="files-when">{when(e.mtime)}</span>}
              </button>
            );
          })}
          {!entries.length && <div className="files-empty">No canvases here yet.</div>}
        </div>

        {/* Screen orientation, as in Writerdeck: tap to step through, or ‹ › either way (Ctrl+Shift+R too). */}
        {store.canOrient() && (
          <div className="files-orient">
            <span className="files-orient-label">Orientation</span>
            <button className="files-orient-step" aria-label="Previous" onClick={() => setOrient(store.stepOrientation(-1))}>
              <ChevronLeft size={18} />
            </button>
            <button className="files-orient-value" onClick={() => setOrient(store.stepOrientation(1))}>
              {store.ORIENTATION_NAMES[orient]}
            </button>
            <button className="files-orient-step" aria-label="Next" onClick={() => setOrient(store.stepOrientation(1))}>
              <ChevronRight size={18} />
            </button>
          </div>
        )}
        {store.onDevice && (
          <button className="files-change" onClick={() => void store.chooseFolder()}>Use a different folder…</button>
        )}
        <button className="files-change files-about-open" onClick={() => setAbout(true)}>About Supercanvas</button>
        </>)}
      </div>
    </div>
  );
}
