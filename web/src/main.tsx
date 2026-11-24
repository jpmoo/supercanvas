// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
/*
 * Supercanvas: Talaris's canvas, on its own, for the Supernote Nomad.
 *
 * One folder of canvas files. A canvas is one `.supercanvas` file (JSON, with
 * its pictures inside) and is saved to it a moment after every change. There
 * is no sync, no core, no conversion: open a file, work, it is saved.
 */
import { Component, StrictMode, useCallback, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { CanvasView } from "./components/CanvasView.tsx";
import { CanvasTools } from "./components/CanvasTools.tsx";
import { Files } from "./components/Files.tsx";
import { Picker } from "./components/Pickers.tsx";
import { flush, hold, onSaveFailed, where, type Collection, type Member } from "./api.ts";
import { getDocument, toCollection, toMembers } from "./document.ts";
import * as store from "./store.ts";
import "./canvas-forked.css";
import "./canvas.css";
import "./eink.css";
import { wearTheme } from "./theme.ts";
import "./longpress.ts";
import { penEnd } from "./ink.ts";

const LAST = "supercanvas.last";
const remembered = () => {
  try { return localStorage.getItem(LAST) || ""; } catch { return ""; }
};
const remember = (path: string) => {
  try { localStorage.setItem(LAST, path); } catch { /* private */ }
};

/** The canvas to open first: the one open last, if it is still there, else a new one. */
function firstCanvas(): string {
  const last = remembered();
  if (last && store.read(last) !== null) return last;
  const newest = store.list("").find((e) => !e.dir);
  if (newest) return newest.name;
  const name = store.freeName("", "My canvas");
  store.write(name, JSON.stringify({ format: 1, app: "supercanvas", items: [], links: [], regions: [] }));
  return name;
}

function Canvas({ path, onFiles }: { path: string; onFiles: () => void }) {
  const [state, setState] = useState<{ collection: Collection; members: Member[] } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      // Anything pending goes out first, or re-reading would throw it away.
      await flush();
      const doc = await getDocument();
      hold(doc, () => {});
      setState({ collection: toCollection(doc), members: toMembers(doc, []) });
    } catch (err) {
      setFailure(String((err as Error).message || err));
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read, path]);

  if (failure) return <div className="canvas-waiting">{failure}</div>;
  if (!state) return <div className="canvas-waiting">Opening…</div>;
  return (
    <>
      <CanvasView collection={state.collection} members={state.members} types={[]} onChanged={() => void read()} />
      <CanvasTools onPlaced={() => read()} onFiles={onFiles} />
    </>
  );
}

function App() {
  const [ready, setReady] = useState(store.hasFolder());
  const [path, setPath] = useState<string | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [picking, setPicking] = useState<{ kind: "folder" | "picture"; done: (v: string | null) => void } | null>(null);
  useEffect(() => onSaveFailed((why) => setNotice(`Not saved: ${why}`)), []);
  useEffect(() => store.onPickerAsked((a) => setPicking({
    kind: a.kind,
    done: (v) => { setPicking(null); a.done(v); },
  })), []);

  // The Android side says when a folder has been picked.
  useEffect(() => {
    (window as unknown as { sc: Record<string, unknown> }).sc = {
      onFolder: () => {
        setReady(store.hasFolder());
        setPath(null);
        setFilesOpen(false);
      },
      picked: (d: string | null) => store.systemPicked(d),
      // The pen turned over or back (MainActivity sees the eraser end; the WebView doesn't say).
      penEnd: (end: string) => penEnd(end),
      flush: () => void flush(),
      // Back: close whatever is open, and say whether anything was.
      back: () => {
        if (document.querySelector(".pick-panel")) {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          return true;
        }
        const open = document.querySelector(".files-panel, .ctx-menu, .modal-backdrop");
        if (open) {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          setFilesOpen(false);
          return true;
        }
        return false;
      },
    };
  }, []);

  useEffect(() => {
    if (ready && path === null) open(firstCanvas());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, path]);

  async function open(next: string) {
    await flush();
    where.canvas = next;
    remember(next);
    setPath(next);
    setFilesOpen(false);
  }

  if (!ready) {
    return (
      <div className="canvas-waiting">
        <div className="welcome">
          <h1>Supercanvas</h1>
          <p>Pick a folder to keep your canvases in — for example <b>Document/Canvases</b>.</p>
          <button className="big-btn" onClick={() => void store.chooseFolder()}>Choose a folder</button>
        </div>
        {picking && <Picker kind={picking.kind} done={picking.done} />}
      </div>
    );
  }
  if (path === null) return <div className="canvas-waiting">Opening…</div>;
  return (
    <>
      {/* Keyed by file, so a canvas switched to starts clean. */}
      <Canvas key={path} path={path} onFiles={() => setFilesOpen((o) => !o)} />
      <div className="sc-title" onClick={() => setFilesOpen(true)}>{store.titleOf(path)}</div>
      {filesOpen && (
        <Files
          current={path}
          onOpen={(p) => void open(p)}
          onRenamed={(p) => {
            where.canvas = p;
            remember(p);
            setPath(p);
          }}
          onDeleted={() => {
            remember("");
            setPath(null);
          }}
          onClose={() => setFilesOpen(false)}
        />
      )}
      {picking && <Picker kind={picking.kind} done={picking.done} />}
      {notice && <div className="sc-notice" onClick={() => setNotice(null)}>{notice}</div>}
    </>
  );
}

class Boundary extends Component<{ children: ReactNode }, { failure: Error | null }> {
  state = { failure: null as Error | null };
  static getDerivedStateFromError(failure: Error) {
    return { failure };
  }
  componentDidCatch(failure: Error, info: { componentStack?: string | null }) {
    console.error("canvas:", failure.message, failure.stack, info.componentStack);
  }
  render() {
    if (!this.state.failure) return this.props.children;
    return (
      <div className="canvas-waiting">
        <div>
          <p>The canvas could not be drawn.</p>
          <pre>{this.state.failure.message}</pre>
          <button className="big-btn" onClick={() => location.reload()}>Try again</button>
        </div>
      </div>
    );
  }
}

wearTheme();
createRoot(document.getElementById("canvas-root")!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);
