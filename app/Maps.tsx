import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from "react";
import type { MapItem, MapsTab } from "./portfolio";

// =====================================================================
//  MAPS TAB  -  a grid of zoomable / pannable PDFs (or images).
//  Content lives in portfolio.ts. This file only needs editing to change
//  how the viewer behaves; the knobs are right below.
//
//  Needs one package:   npm install pdfjs-dist
//  (only used for PDFs; it loads the first time a PDF scrolls into view)
// =====================================================================

// ---- Knobs --------------------------------------------------------------
const WHEEL_ZOOMS_WITHOUT_CTRL = false; // true = plain mouse wheel zooms (page can't scroll while over a map)
const DEFAULT_MAX_ZOOM = 12; // how far visitors can zoom in (a map can override with maxZoom)
const BUTTON_ZOOM_STEP = 1.6; // zoom factor of the + and - buttons
const DOUBLE_CLICK_ZOOM = 3; // double-click / double-tap zooms to this level (again = back to fit)
const GRID_GAP = 6; // px between maps. Smaller = more seamless
const TILE_RADIUS = 4; // px corner rounding of each map
const DEFAULT_ROWS = [2, 1, 2, 2];
const DEFAULT_ASPECT: { [n: number]: string } = { 1: "2 / 1", 2: "4 / 3" };
const FALLBACK_ASPECT = "4 / 3";
// Sharpness vs. memory. Rarely needs changing.
const MAX_CANVAS_PIXELS = 16_000_000; // browsers fail above ~16 million pixels per canvas
const BASE_OVERSAMPLE = 1.5; // the resting picture is drawn at this multiple of the screen size
const DETAIL_DELAY_MS = 120; // wait this long after a zoom / pan before redrawing it sharp
// -------------------------------------------------------------------------

// Minimal shapes of the parts of pdf.js we use (keeps this file independent of its version)
type PdfPage = {
  getViewport(o: { scale: number; offsetX?: number; offsetY?: number }): { width: number; height: number };
  render(o: Record<string, unknown>): { promise: Promise<unknown>; cancel(): void };
};
type PdfDoc = { getPage(n: number): Promise<PdfPage> };

let pdfjsPromise: Promise<any> | null = null;
const docCache = new Map<string, Promise<PdfDoc>>();

// Loaded on demand (and only in the browser), so the rest of the site stays light.
function loadPdf(url: string): Promise<PdfDoc> {
  let p = docCache.get(url);
  if (!p) {
    p = (async () => {
      if (!pdfjsPromise) {
        pdfjsPromise = (async () => {
          // The "legacy" build also works in browsers that are a year or two old.
          // @ts-ignore  (types come from the pdfjs-dist package)
          const lib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
          // @ts-ignore  (Vite turns "?url" into the file's address)
          const worker: any = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
          lib.GlobalWorkerOptions.workerSrc = worker.default;
          return lib;
        })();
      }
      const lib = await pdfjsPromise;
      return lib.getDocument({ url }).promise as Promise<PdfDoc>;
    })();
    docCache.set(url, p);
    p.catch(() => docCache.delete(url));
  }
  return p;
}

const isPdf = (src?: string) => !!src && /\.pdf(\?|#|$)/i.test(src);
const isCancel = (e: unknown) => !!e && typeof e === "object" && (e as { name?: string }).name === "RenderingCancelledException";

type View = { k: number; tx: number; ty: number };

function MapViewer({ item, topInset }: { item: MapItem; topInset: number }) {
  const pdf = isPdf(item.src);
  const bg = item.bg ?? "#ffffff";
  const maxZoom = item.maxZoom ?? DEFAULT_MAX_ZOOM;

  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const detailRef = useRef<HTMLCanvasElement>(null);

  const pageRef = useRef<PdfPage | null>(null);
  const natRef = useRef<{ w: number; h: number } | null>(null);
  const viewRef = useRef<View>({ k: 1, tx: 0, ty: 0 });
  const sizeRef = useRef({ cw: 0, ch: 0, f: 1 });
  const tasksRef = useRef<{ base?: { cancel(): void }; detail?: { cancel(): void } }>({});
  const detailTimer = useRef(0);
  const baseTimer = useRef(0);
  const gen = useRef(0); // bumps on every view change so stale sharp renders are dropped
  const hintTimer = useRef(0);
  const animTimer = useRef(0);
  const expandedRef = useRef(false);

  const [active, setActive] = useState(false); // has scrolled near the screen
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hint, setHint] = useState(false);
  expandedRef.current = expanded;

  // ---- Start loading only when the tile is near the screen ----
  useEffect(() => {
    const el = hostRef.current;
    if (!el || !item.src) return;
    if (typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setActive(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [item.src]);

  // ---- Load the PDF page (or the image) and learn its natural size ----
  useEffect(() => {
    if (!active || !item.src) return;
    let dead = false;
    setStatus("loading");
    if (pdf) {
      loadPdf(item.src)
        .then((doc) => doc.getPage(item.page ?? 1))
        .then((page) => {
          if (dead) return;
          pageRef.current = page;
          const vp = page.getViewport({ scale: 1 });
          natRef.current = { w: vp.width, h: vp.height };
          setNat(natRef.current);
          setStatus("ready");
        })
        .catch(() => !dead && setStatus("error"));
    }
    return () => {
      dead = true;
    };
  }, [active, item.src, item.page, pdf]);

  // ---- Geometry helpers ----
  const clamp = useCallback((v: View): View => {
    const n = natRef.current;
    if (!n) return v;
    const { cw, ch, f } = sizeRef.current;
    const axis = (size: number, box: number, t: number) => (size <= box ? (box - size) / 2 : Math.min(0, Math.max(box - size, t)));
    return { k: v.k, tx: axis(n.w * f * v.k, cw, v.tx), ty: axis(n.h * f * v.k, ch, v.ty) };
  }, []);

  const renderDetail = useCallback(async () => {
    const page = pageRef.current;
    const detail = detailRef.current;
    const n = natRef.current;
    if (!page || !detail || !n) return;
    const v = viewRef.current;
    if (v.k <= 1.2) return; // the resting picture is sharp enough
    const myGen = gen.current;
    const { cw, ch, f } = sizeRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let px = Math.round(cw * dpr);
    let py = Math.round(ch * dpr);
    const squeeze = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (px * py)));
    px = Math.round(px * squeeze);
    py = Math.round(py * squeeze);
    const s = f * v.k * dpr * squeeze;
    const off = document.createElement("canvas");
    off.width = px;
    off.height = py;
    try {
      const vp = page.getViewport({ scale: s, offsetX: v.tx * dpr * squeeze, offsetY: v.ty * dpr * squeeze });
      tasksRef.current.detail?.cancel();
      const task = page.render({ canvas: off, canvasContext: off.getContext("2d"), viewport: vp, background: bg });
      tasksRef.current.detail = task;
      await task.promise;
      if (myGen !== gen.current) return; // user moved again: this picture is already out of date
      detail.width = px;
      detail.height = py;
      detail.getContext("2d")?.drawImage(off, 0, 0);
      detail.style.display = "block";
    } catch (e) {
      if (!isCancel(e)) console.warn("map: detail render failed", e);
    }
  }, [bg]);

  const renderBase = useCallback(async () => {
    const page = pageRef.current;
    const base = baseRef.current;
    const n = natRef.current;
    if (!page || !base || !n) return;
    const { f } = sizeRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cap = Math.sqrt(MAX_CANVAS_PIXELS / (n.w * n.h));
    const s = Math.min(f * dpr * BASE_OVERSAMPLE, cap);
    const off = document.createElement("canvas");
    try {
      const vp = page.getViewport({ scale: s });
      off.width = Math.ceil(vp.width);
      off.height = Math.ceil(vp.height);
      tasksRef.current.base?.cancel();
      const task = page.render({ canvas: off, canvasContext: off.getContext("2d"), viewport: vp, background: bg });
      tasksRef.current.base = task;
      await task.promise;
      base.width = off.width;
      base.height = off.height;
      base.getContext("2d")?.drawImage(off, 0, 0);
    } catch (e) {
      if (!isCancel(e)) {
        console.warn("map: render failed", e);
        setStatus("error");
      }
    }
  }, [bg]);

  // Put the current view on screen
  const apply = useCallback(
    (animate = false) => {
      const stage = stageRef.current;
      if (!stage) return;
      const v = viewRef.current;
      window.clearTimeout(animTimer.current);
      stage.style.transition = animate ? "transform 0.18s ease-out" : "none";
      if (animate) animTimer.current = window.setTimeout(() => (stage.style.transition = "none"), 220);
      stage.style.transform = "translate(" + v.tx + "px," + v.ty + "px) scale(" + v.k + ")";
      setZoomed(v.k > 1.01);
      gen.current += 1;
      tasksRef.current.detail?.cancel();
      if (detailRef.current) detailRef.current.style.display = "none";
      window.clearTimeout(detailTimer.current);
      if (pdf) detailTimer.current = window.setTimeout(renderDetail, DETAIL_DELAY_MS + (animate ? 200 : 0));
    },
    [pdf, renderDetail]
  );

  const setView = useCallback(
    (v: View, animate = false) => {
      viewRef.current = clamp(v);
      apply(animate);
    },
    [clamp, apply]
  );

  const zoomAt = useCallback(
    (nextK: number, px: number, py: number, animate = false) => {
      const v = viewRef.current;
      const k = Math.min(maxZoom, Math.max(1, nextK));
      const r = k / v.k;
      setView({ k, tx: px - (px - v.tx) * r, ty: py - (py - v.ty) * r }, animate);
    },
    [maxZoom, setView]
  );

  const zoomCenter = useCallback(
    (factor: number) => {
      const { cw, ch } = sizeRef.current;
      zoomAt(viewRef.current.k * factor, cw / 2, ch / 2, true);
    },
    [zoomAt]
  );

  const fit = useCallback(() => setView({ k: 1, tx: 0, ty: 0 }, true), [setView]);

  // ---- Measure the tile; fit the map into it; redraw when it changes size ----
  const layout = useCallback(() => {
    const viewer = viewerRef.current;
    const stage = stageRef.current;
    const n = natRef.current;
    if (!viewer || !stage || !n) return;
    const cw = viewer.clientWidth;
    const ch = viewer.clientHeight;
    if (!cw || !ch) return;
    const f = Math.min(cw / n.w, ch / n.h);
    sizeRef.current = { cw, ch, f };
    stage.style.width = n.w * f + "px";
    stage.style.height = n.h * f + "px";
    viewRef.current = clamp(viewRef.current);
    apply();
    if (pdf) {
      window.clearTimeout(baseTimer.current);
      baseTimer.current = window.setTimeout(renderBase, 60);
    }
  }, [clamp, apply, pdf, renderBase]);

  useLayoutEffect(() => {
    layout();
  }, [nat, layout]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => layout());
    ro.observe(viewer);
    return () => ro.disconnect();
  }, [layout]);

  // Opening / closing the large view starts from the fitted map
  useEffect(() => {
    viewRef.current = { k: 1, tx: 0, ty: 0 };
    layout();
  }, [expanded, layout]);

  useEffect(
    () => () => {
      window.clearTimeout(detailTimer.current);
      window.clearTimeout(baseTimer.current);
      window.clearTimeout(hintTimer.current);
      window.clearTimeout(animTimer.current);
      tasksRef.current.base?.cancel();
      tasksRef.current.detail?.cancel();
    },
    []
  );

  // ---- Mouse wheel, pinch, drag ----
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const onWheel = (e: WheelEvent) => {
      const canZoom = e.ctrlKey || e.metaKey || WHEEL_ZOOMS_WITHOUT_CTRL || expandedRef.current;
      if (!canZoom) {
        setHint(true);
        window.clearTimeout(hintTimer.current);
        hintTimer.current = window.setTimeout(() => setHint(false), 1400);
        return; // let the page scroll
      }
      e.preventDefault();
      const rect = viewer.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 33 : 1; // Firefox reports lines, not pixels
      const speed = e.ctrlKey ? 0.01 : 0.0018; // trackpad pinch sends small ctrl+wheel steps
      zoomAt(viewRef.current.k * Math.exp(-e.deltaY * unit * speed), e.clientX - rect.left, e.clientY - rect.top);
    };
    viewer.addEventListener("wheel", onWheel, { passive: false });

    const pts = new Map<number, { x: number; y: number }>();
    let pan: { x: number; y: number; tx: number; ty: number } | null = null;
    let pinch: { dist: number; k: number; cx: number; cy: number; tx: number; ty: number } | null = null;

    const local = (e: PointerEvent) => {
      const r = viewer.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const startPan = () => {
      const [p] = Array.from(pts.values());
      const v = viewRef.current;
      pan = p ? { x: p.x, y: p.y, tx: v.tx, ty: v.ty } : null;
      pinch = null;
    };
    const startPinch = () => {
      const [a, b] = Array.from(pts.values());
      const v = viewRef.current;
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: v.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx: v.tx, ty: v.ty };
      pan = null;
    };

    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest(".mv-ctl")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pts.set(e.pointerId, local(e));
      try {
        viewer.setPointerCapture(e.pointerId);
      } catch {}
      if (pts.size === 1) startPan();
      else if (pts.size === 2) startPinch();
    };
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      if (pinch && pts.size >= 2) {
        const [a, b] = Array.from(pts.values());
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const k = Math.min(maxZoom, Math.max(1, pinch.k * (dist / pinch.dist)));
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        // keep the map point that started under the fingers under the fingers
        const ox = (pinch.cx - pinch.tx) / pinch.k;
        const oy = (pinch.cy - pinch.ty) / pinch.k;
        setView({ k, tx: mx - ox * k, ty: my - oy * k });
      } else if (pan && viewRef.current.k > 1.001) {
        const p = pts.get(e.pointerId)!;
        setView({ k: viewRef.current.k, tx: pan.tx + (p.x - pan.x), ty: pan.ty + (p.y - pan.y) });
      }
    };
    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      try {
        viewer.releasePointerCapture(e.pointerId);
      } catch {}
      if (pts.size === 1) startPan();
      else if (pts.size === 0) {
        pan = null;
        pinch = null;
      }
    };
    const onDouble = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".mv-ctl")) return;
      const r = viewer.getBoundingClientRect();
      if (viewRef.current.k > 1.5) fit();
      else zoomAt(DOUBLE_CLICK_ZOOM, e.clientX - r.left, e.clientY - r.top, true);
    };

    viewer.addEventListener("pointerdown", onDown);
    viewer.addEventListener("pointermove", onMove);
    viewer.addEventListener("pointerup", onUp);
    viewer.addEventListener("pointercancel", onUp);
    viewer.addEventListener("dblclick", onDouble);
    return () => {
      viewer.removeEventListener("wheel", onWheel);
      viewer.removeEventListener("pointerdown", onDown);
      viewer.removeEventListener("pointermove", onMove);
      viewer.removeEventListener("pointerup", onUp);
      viewer.removeEventListener("pointercancel", onUp);
      viewer.removeEventListener("dblclick", onDouble);
    };
  }, [zoomAt, setView, fit, maxZoom]);

  // ---- Keyboard ----
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = 70;
    const v = viewRef.current;
    if (e.key === "+" || e.key === "=") zoomCenter(BUTTON_ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") zoomCenter(1 / BUTTON_ZOOM_STEP);
    else if (e.key === "0") fit();
    else if (v.k > 1.001 && e.key === "ArrowLeft") setView({ ...v, tx: v.tx + step });
    else if (v.k > 1.001 && e.key === "ArrowRight") setView({ ...v, tx: v.tx - step });
    else if (v.k > 1.001 && e.key === "ArrowUp") setView({ ...v, ty: v.ty + step });
    else if (v.k > 1.001 && e.key === "ArrowDown") setView({ ...v, ty: v.ty - step });
    else return;
    e.preventDefault();
  };

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const imgSize = (e: SyntheticEvent<HTMLImageElement>) => {
    const im = e.currentTarget;
    const w = im.naturalWidth || 1200;
    const h = im.naturalHeight || 800;
    natRef.current = { w, h };
    setNat({ w, h });
    setStatus("ready");
  };

  const label = item.title ?? item.alt ?? "Map";

  return (
    <div ref={hostRef} className="mv-host" style={{ background: bg }}>
      <div
        ref={viewerRef}
        className={"mv" + (expanded ? " mv-expanded" : "")}
        style={{
          background: bg,
          top: expanded ? topInset : undefined,
          touchAction: expanded || zoomed ? "none" : "pan-y",
        }}
        tabIndex={item.src ? 0 : -1}
        role="group"
        aria-label={label + (item.src ? " (zoomable map: use plus, minus and arrow keys)" : "")}
        onKeyDown={item.src ? onKeyDown : undefined}
      >
        {!item.src && (
          <div className="mv-msg">
            <span>{item.title ?? "Map"}</span>
          </div>
        )}

        {item.src && (
          <div ref={stageRef} className="mv-stage" style={{ visibility: status === "ready" ? "visible" : "hidden" }}>
            {pdf ? (
              <canvas ref={baseRef} role="img" aria-label={item.alt ?? label} />
            ) : (
              active && <img src={item.src} alt={item.alt ?? label} draggable={false} onLoad={imgSize} onError={() => setStatus("error")} />
            )}
          </div>
        )}
        {pdf && <canvas ref={detailRef} className="mv-detail" aria-hidden="true" />}

        {item.src && status === "loading" && <div className="mv-msg"><span>Loading map…</span></div>}
        {item.src && status === "error" && (
          <div className="mv-msg">
            <span>
              Could not load this map.
              <br />
              Check the path: {item.src}
            </span>
          </div>
        )}

        {item.title && item.src && <div className="mv-title">{item.title}</div>}
        {hint && <div className="mv-hint">Hold Ctrl (⌘ on Mac) and scroll to zoom</div>}

        {item.src && status === "ready" && (
          <div className="mv-ctl" role="toolbar" aria-label="Map controls">
            <button type="button" className="clickable" onClick={() => zoomCenter(BUTTON_ZOOM_STEP)} aria-label="Zoom in" title="Zoom in">
              +
            </button>
            <button type="button" className="clickable" onClick={() => zoomCenter(1 / BUTTON_ZOOM_STEP)} aria-label="Zoom out" title="Zoom out">
              −
            </button>
            <button type="button" className="clickable" onClick={fit} aria-label="Fit to view" title="Fit to view" disabled={!zoomed}>
              ⤾
            </button>
            <button
              type="button"
              className="clickable"
              onClick={() => setExpanded((x) => !x)}
              aria-label={expanded ? "Close large view" : "Open large view"}
              title={expanded ? "Close (Esc)" : "Open large view"}
            >
              {expanded ? "✕" : "⤢"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Splits the list of maps into rows following the `rows` pattern (repeating)
function chunk(maps: MapItem[], pattern: number[]) {
  const out: MapItem[][] = [];
  let i = 0;
  let r = 0;
  while (i < maps.length) {
    const n = Math.max(1, pattern[r % pattern.length] | 0);
    out.push(maps.slice(i, i + n));
    i += n;
    r += 1;
  }
  return out.map((items, idx) => ({ items, cols: Math.max(1, pattern[idx % pattern.length] | 0) }));
}

export default function Maps({ tab, topInset }: { tab: MapsTab; topInset: number }) {
  const pattern = tab.rows && tab.rows.length ? tab.rows : DEFAULT_ROWS;
  const rows = chunk(tab.maps, pattern);

  return (
    <>
      <style>{`
        .maps { max-width: 1240px; margin: 0 auto; display: flex; flex-direction: column; gap: ${GRID_GAP}px; }
        .maps-note { max-width: 1240px; margin: 0 auto 18px; font-size: 12.5px; line-height: 1.55; color: var(--muted); }
        .maps-row { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: ${GRID_GAP}px; }
        @media (max-width: 800px) { .maps-row { grid-template-columns: minmax(0, 1fr); } }

        .mv-host { box-sizing: border-box; position: relative; width: 100%; aspect-ratio: var(--aspect); border: 1px solid var(--border); border-radius: ${TILE_RADIUS}px; overflow: hidden; }
        .mv { position: absolute; inset: 0; overflow: hidden; outline: none; user-select: none; -webkit-user-select: none; }
        .mv:focus-visible { box-shadow: inset 0 0 0 2px var(--fg); }
        .mv-expanded { position: fixed; inset: 0; z-index: 50; }
        .mv-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
        .mv-stage canvas, .mv-stage img { width: 100%; height: 100%; display: block; }
        .mv-detail { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: none; pointer-events: none; }
        .mv-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 12px;
          font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); background: var(--ph); pointer-events: none; }
        .mv-title { position: absolute; left: 8px; top: 8px; padding: 2px 8px; border-radius: 999px; font-size: 11px; color: var(--fg);
          background: var(--bar); border: 1px solid var(--border); pointer-events: none; }
        .mv-hint { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); padding: 5px 12px; border-radius: 999px; font-size: 12px;
          color: var(--fg); background: var(--bar); border: 1px solid var(--border); pointer-events: none; white-space: nowrap; animation: popIn 0.14s ease-out; }
        .mv-ctl { position: absolute; right: 8px; top: 8px; display: flex; flex-direction: column; gap: 4px; opacity: 0; transition: opacity 0.15s; }
        .mv:hover .mv-ctl, .mv:focus-within .mv-ctl, .mv-expanded .mv-ctl { opacity: 1; }
        @media (hover: none) { .mv-ctl { opacity: 0.9; } }
        .mv-ctl button { width: 30px; height: 30px; border-radius: 8px; font-size: 16px; line-height: 1; padding: 0; color: var(--fg);
          background: var(--bar); border: 1px solid var(--border); backdrop-filter: blur(8px); }
        .mv-ctl button:hover:not(:disabled) { background: var(--panel); }
        .mv-ctl button:disabled { opacity: 0.4; }
        .mv-ctl button:focus-visible { outline: 2px solid var(--fg); outline-offset: 1px; }
        .mv-expanded .mv-title { left: 12px; top: 12px; font-size: 12px; }
        .mv-expanded .mv-ctl { right: 12px; top: 12px; }
      `}</style>

      {tab.disclaimer && <p className="maps-note">{tab.disclaimer}</p>}

      <div className="maps">
        {rows.map((row, ri) => (
          <div key={ri} className="maps-row" style={{ ["--cols" as string]: row.cols }}>
            {row.items.map((m, mi) => (
              <div
                key={ri + "-" + mi}
                style={{ ["--aspect" as string]: m.aspect ?? tab.aspect?.[row.cols] ?? DEFAULT_ASPECT[row.cols] ?? FALLBACK_ASPECT, minWidth: 0 }}
              >
                <MapViewer item={m} topInset={topInset} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
