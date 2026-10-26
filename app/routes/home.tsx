import { Fragment, useEffect, useRef, useState } from "react";
import Bento from "../Bento";
import Maps from "../Maps";
import { PORTFOLIO } from "../portfolio";

export function meta() {
  return [{ title: "dnhn canvas" }];
}

export function links() {
  return [
    { rel: "icon", href: "/favicon.ico", sizes: "any" },
    { rel: "icon", type: "image/png", href: "/favicon.png" },
  ];
}

// ---- Greeting text (top-left) ----
// Right-click the text on the page to edit it (edits last until the page is reloaded).
// To change what everyone sees by default, change this line:
const DEFAULT_GREETING = "Hello. My Name is Donghoon! :D";

// Small link in the top-right corner, next to the light / dark button.
// Put your PDF in public/pdfs/ and set its path here. Use "" to hide the link.
const RESUME_URL = "/pdfs/my_resume_2026.pdf";
const RESUME_LABEL = "Résumé";
// More text links like Resume ("Behance ↗", "Contact ↗"...). Add or remove lines freely. Use [] for none.
// For an email, use url: "mailto:you@example.com".
const TEXT_LINKS: { label: string; url: string }[] = [
  
];

// Small icon links next to the Resume link. Add, remove or reorder lines freely.
// icon: "instagram" or "link". url: where it goes. Use [] to hide them all.
const ICON_LINKS: { icon: "instagram" | "link" | "email" | "linkedin"; url: string; label: string }[] = [
  { icon: "link", url: "https://dnhn-design.github.io/portfolio/", label: "Archive" },
  { icon: "instagram", url: "https://www.instagram.com/dnhn.design/", label: "Instagram" },
  { icon: "email", url: "mailto:donghoon.yi.portfolio@gmail.com", label: "Email" },
  { icon: "linkedin", url: "https://www.linkedin.com/in/donghoon-yi/", label: "LinkedIn" },

];

// Saved pictures are named dnhn-canvas-1.png, dnhn-canvas-2.png ... (the number restarts each time the page is opened).
const SHOT_PREFIX = "dnhn-canvas-";
const GREETING_MAX_LENGTH = 120;

// ---- Text physics (tweak the feel here) ----
const RADIUS = 140;
const PUSH = 1.4;
const SPRING = 0.07;
const DAMPING = 0.84;
const MAX_OFFSET = 28;

// ---- Scroll thickness feel ----
const WHEEL_STEP = 40; // scroll distance needed per 1px change (bigger = slower)
const WHEEL_COOLDOWN = 45; // min ms between changes (bigger = less momentum)
const TAB_BAR_H = 38;

// ---- Brush options ----
const STYLES = [
  { id: "solid", label: "Solid" },
  { id: "neon", label: "Neon" },
  { id: "pencil", label: "Pencil" },
  { id: "dotted", label: "Dotted" },
  { id: "dashed", label: "Dashed" },
  { id: "double", label: "Double" },
  { id: "line", label: "Line" },
  { id: "eraser", label: "Eraser" },
] as const;

type StyleId = (typeof STYLES)[number]["id"];

// "ink" is a special color that follows the theme (white in dark mode, near-black in light mode)
const COLORS = [
  "ink",
  "#ff5a5f",
  "#ff9f43",
  "#feca57",
  "#1dd1a1",
  "#48dbfb",
  "#5f7cff",
  "#b46bff",
  "#ff6bd6",
];

type Theme = "dark" | "light";
const inkFor = (t: Theme) => (t === "dark" ? "#f5f5f7" : "#16161d");

type Brush = { color: string; style: StyleId; size: number };
type Pt = { x: number; y: number };
type Rect = { x0: number; y0: number; x1: number; y1: number };
type StrokeOp = { kind: "stroke"; id: number; brush: Brush; seed: number; pts: Pt[] };
type MoveOp = { kind: "move"; ids: number[]; dx: number; dy: number };
type DeleteOp = { kind: "delete"; ids: number[] };
type Op = StrokeOp | MoveOp | DeleteOp | { kind: "clear" };
type Tool = "draw" | "select";
type Selection = { ids: number[]; x: number; y: number; w: number; h: number };
type TabData = { ops: Op[]; cursor: number };
type CanvasTab = { id: string; name: string };

type Particle = {
  el: HTMLElement;
  restX: number;
  restY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

// How far a stroke's paint reaches beyond its center line (used for selecting + the selection box)
function strokePad(b: Brush) {
  let r = b.size / 2;
  if (b.style === "eraser") r = b.size * 0.75;
  if (b.style === "double") r = b.size * 0.8 + Math.max(1, b.size / 3) / 2;
  if (b.style === "neon") r = b.size;
  return r + 1;
}

// Does the line segment a-b touch the rectangle r? (Liang-Barsky clipping)
function segHitsRect(a: Pt, b: Pt, r: Rect) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.x0, r.x1 - a.x, a.y - r.y0, r.y1 - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

// ---- Pie menu geometry ----
const PIE_R = 160; // outer radius of the whole menu (px)
const RING1 = { r0: 36, r1: 92 };
const RING2 = { r0: 98, r1: 152 };

// ---- Pie menu on touch screens: one ring at a time, centre = back, slider below for thickness ----
const PIE_R_TOUCH = 160;
const TOUCH_RING = { r0: 44, r1: 114 };
const TOUCH_CENTER_R = 34;
const TOUCH_SLIDER_R = 132;
const LONG_PRESS_MS = 450; // how long to hold a finger to open the menu
const LONG_PRESS_SLOP = 10; // moving further than this (px) means it's a drawing stroke instead

type Slice = {
  id: string;
  label: string;
  icon?: string;
  iconColor?: string;
  fill?: string;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

const rad = (deg: number) => (deg * Math.PI) / 180;

function wedge(r0: number, r1: number, a0: number, a1: number) {
  const pt = (r: number, a: number) => [r * Math.cos(rad(a)), r * Math.sin(rad(a))];
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return (
    "M" + x0 + " " + y0 +
    " A" + r1 + " " + r1 + " 0 " + large + " 1 " + x1 + " " + y1 +
    " L" + x2 + " " + y2 +
    " A" + r0 + " " + r0 + " 0 " + large + " 0 " + x3 + " " + y3 +
    " Z"
  );
}

function Ring(props: { slices: Slice[]; r0: number; r1: number }) {
  const { slices, r0, r1 } = props;
  const n = slices.length;
  const step = 360 / n;
  const gap = 2.5;
  const rm = (r0 + r1) / 2;

  return (
    <g>
      {slices.map((s, i) => {
        const mid = -90 + i * step; // first slice sits at the top
        const a0 = mid - step / 2 + gap / 2;
        const a1 = mid + step / 2 - gap / 2;
        const tx = rm * Math.cos(rad(mid));
        const ty = rm * Math.sin(rad(mid));
        const hasIcon = !!s.icon;
        const hasLabel = s.label !== "";
        return (
          <g
            key={s.id}
            className="clickable"
            onClick={s.onSelect}
            style={{
              opacity: s.disabled ? 0.35 : 1,
              pointerEvents: s.disabled ? "none" : "auto",
            }}
          >
            <path
              className={(s.fill ? "pie-color" : "pie-dark") + (s.active ? " pie-active" : "")}
              d={wedge(r0, r1, a0, a1)}
              fill={s.fill}
            />
            {hasIcon && (
              <text
                x={tx}
                y={ty - (hasLabel ? 8 : 0)}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={18}
                className={s.iconColor ? undefined : "pie-text"}
                style={{ fill: s.iconColor, pointerEvents: "none", userSelect: "none" }}
              >
                {s.icon}
              </text>
            )}
            {hasLabel && (
              <text
                x={tx}
                y={ty + (hasIcon ? 11 : 0)}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                className="pie-text"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

// Small seeded random so pencil strokes look identical when redrawn (undo/redo, move, resize)
function mulberry32(seed: number) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Painting one whole stroke ----------
// Every stroke is drawn from its full list of points, the same way live and on replay
// (undo / redo / move / resize). That keeps joints clean: no per-segment artifacts.

const NEON_GLOW = 2.5; // glow size = brush size x this

// Calls fn at evenly spaced distances along the polyline (first call at the very start)
function walkPath(pts: Pt[], spacing: number, fn: (x: number, y: number) => void) {
  fn(pts[0].x, pts[0].y);
  let next = spacing;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    while (next <= acc + len) {
      const t = (next - acc) / len;
      fn(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      next += spacing;
    }
    acc += len;
  }
}

// Round-capped line through the points (a dot if there is only one point)
function strokeRound(ctx: CanvasRenderingContext2D, pts: Pt[], width: number) {
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

// Dashes with flat (butt) ends, including the very first and last dash
function strokeDashes(ctx: CanvasRenderingContext2D, pts: Pt[], width: number, on: number, period: number) {
  ctx.lineWidth = width;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.miterLimit = 2;
  ctx.beginPath();
  let pos = 0;
  let lastK = -1;
  let lastEnd = -1;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const segStart = pos;
    const segEnd = pos + len;
    for (let k = Math.floor(segStart / period); ; k++) {
      const d0 = k * period;
      if (d0 >= segEnd) break;
      const s = Math.max(d0, segStart);
      const e = Math.min(d0 + on, segEnd);
      if (e <= s) continue;
      const ta = (s - segStart) / len;
      const tb = (e - segStart) / len;
      const x1 = a.x + (b.x - a.x) * tb;
      const y1 = a.y + (b.y - a.y) * tb;
      if (lastK === k && Math.abs(lastEnd - s) < 1e-6) {
        ctx.lineTo(x1, y1); // the dash keeps going around a corner
      } else {
        ctx.moveTo(a.x + (b.x - a.x) * ta, a.y + (b.y - a.y) * ta);
        ctx.lineTo(x1, y1);
      }
      lastK = k;
      lastEnd = e;
    }
    pos = segEnd;
  }
  ctx.stroke();
}

// Two parallel copies of the path, `off` px either side of it
function offsetPaths(pts: Pt[], off: number) {
  const p: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const q = p[p.length - 1];
    if (Math.hypot(pts[i].x - q.x, pts[i].y - q.y) > 0.01) p.push(pts[i]);
  }
  const left: Pt[] = [];
  const right: Pt[] = [];
  if (p.length < 2) return { left, right };

  const n: Pt[] = []; // normal of each segment
  for (let i = 1; i < p.length; i++) {
    const dx = p[i].x - p[i - 1].x;
    const dy = p[i].y - p[i - 1].y;
    const len = Math.hypot(dx, dy);
    n.push({ x: -dy / len, y: dx / len });
  }
  for (let i = 0; i < p.length; i++) {
    let nx: number;
    let ny: number;
    let k = 1;
    if (i === 0) {
      nx = n[0].x;
      ny = n[0].y;
    } else if (i === p.length - 1) {
      nx = n[n.length - 1].x;
      ny = n[n.length - 1].y;
    } else {
      const ax = n[i - 1].x + n[i].x;
      const ay = n[i - 1].y + n[i].y;
      const al = Math.hypot(ax, ay);
      if (al < 1e-6) {
        nx = n[i].x;
        ny = n[i].y;
      } else {
        nx = ax / al;
        ny = ay / al;
        k = 1 / Math.max(0.5, nx * n[i].x + ny * n[i].y); // keeps the gap even around corners
      }
    }
    left.push({ x: p[i].x + nx * off * k, y: p[i].y + ny * off * k });
    right.push({ x: p[i].x - nx * off * k, y: p[i].y - ny * off * k });
  }
  return { left, right };
}

function strokeFlat(ctx: CanvasRenderingContext2D, pts: Pt[], width: number) {
  ctx.lineWidth = width;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.miterLimit = 2;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function paintStroke(ctx: CanvasRenderingContext2D, b: Brush, pts: Pt[], seed: number, ink: string) {
  if (pts.length === 0) return;
  const color = b.color === "ink" ? ink : b.color;
  const dpr = window.devicePixelRatio || 1;

  ctx.save();
  ctx.globalCompositeOperation = b.style === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowBlur = 0;

  switch (b.style) {
    case "solid":
      strokeRound(ctx, pts, b.size);
      break;

    case "eraser":
      strokeRound(ctx, pts, b.size * 1.5);
      break;

    case "line":
      strokeRound(ctx, pts, b.size);
      break;

    case "neon": {
      // One glow pass for the whole path, then a bright core on top: always solid
      ctx.shadowColor = color;
      ctx.shadowBlur = b.size * NEON_GLOW * dpr;
      strokeRound(ctx, pts, b.size);
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      strokeRound(ctx, pts, Math.max(1, b.size * 0.35));
      break;
    }

    case "pencil": {
      // Dense, fine grain packed into a thin line
      const r = Math.max(b.size / 2, 0.6);
      const dots = Math.ceil(r * 2) + 3;
      const rnd = mulberry32(seed);
      const reps = pts.length === 1 ? 5 : 1;
      walkPath(pts, 1, (x, y) => {
        for (let rep = 0; rep < reps; rep++) {
          for (let i = 0; i < dots; i++) {
            const a = rnd() * Math.PI * 2;
            const d = Math.sqrt(rnd()) * r;
            ctx.fillRect(x + Math.cos(a) * d - 0.5, y + Math.sin(a) * d - 0.5, 1, 1);
          }
        }
      });
      break;
    }

    case "dotted": {
      const r = b.size / 2;
      ctx.beginPath();
      walkPath(pts, Math.max(b.size * 2, 4), (x, y) => {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      });
      ctx.fill();
      break;
    }

    case "dashed":
      if (pts.length >= 2) strokeDashes(ctx, pts, b.size, b.size * 1.5, b.size * 3.5);
      break;

    case "double": {
      // Two parallel lines with flat ends: no round brush tip anywhere
      if (pts.length >= 2) {
        const { left, right } = offsetPaths(pts, b.size * 0.8);
        const w = Math.max(1, b.size / 3);
        if (left.length >= 2) {
          strokeFlat(ctx, left, w);
          strokeFlat(ctx, right, w);
        }
      }
      break;
    }
  }
  ctx.restore();
}

// Straight-line brush: snaps the angle (from horizontal) to the nearest 5 degrees
const SNAP_DEG = 5;
function snapLine(o: Pt, p: Pt) {
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  const len = Math.hypot(dx, dy);
  const step = (SNAP_DEG * Math.PI) / 180;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  return { pt: { x: o.x + ux * len, y: o.y + uy * len }, len, ux, uy };
}

export default function Home() {
  const textRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openGestureRef = useRef(false); // true while the finger that opened the menu is still down (its release must not click the menu)
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [barH, setBarH] = useState(TAB_BAR_H); // real height of the tab bar (grows when tabs wrap onto a second line on phones)
  useEffect(() => {
    const el = tabBarRef.current;
    if (!el) return;
    const measure = () => setBarH(Math.max(TAB_BAR_H, Math.round(el.getBoundingClientRect().height)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const selBoxRef = useRef<HTMLDivElement>(null);
  const gizmoRef = useRef<SVGSVGElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const actionsRef = useRef({
    undo: () => {},
    redo: () => {},
    clear: () => {},
    refresh: () => {},
    deselect: () => {},
    deleteSelection: () => {},
  });

  // ---- Select tool ----
  const [tool, setTool] = useState<Tool>("draw");
  const toolRef = useRef<Tool>(tool);
  toolRef.current = tool;
  const [sel, setSel] = useState<Selection | null>(null);
  const selRef = useRef<Selection | null>(null); // written by the drawing handlers
  const strokeIdRef = useRef(0);

  // ---- Greeting text (right-click it, or long-press on a phone, to edit) ----
  const [greeting, setGreeting] = useState(DEFAULT_GREETING);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const editingRef = useRef(false);
  editingRef.current = editing;
  const shown = editing ? draft : greeting;
  const startEditRef = useRef<() => void>(() => {});

  const startEdit = () => {
    if (editingRef.current) return;
    setDraft(greeting);
    setEditing(true);
    setMenu(null);
  };
  startEditRef.current = startEdit;

  const finishEdit = (save: boolean) => {
    if (!editingRef.current) return;
    const v = draft.trim();
    if (save && v) setGreeting(v); // an empty box keeps the old text
    setEditing(false);
  };

  // Focus the text box and select everything when editing starts
  useEffect(() => {
    if (!editing) return;
    const id = window.setTimeout(() => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.select();
      }
    }, 40);
    return () => window.clearTimeout(id);
  }, [editing]);

  // ---- Theme ----
  const [theme, setTheme] = useState<Theme>("dark");
  const themeRef = useRef<Theme>(theme);
  themeRef.current = theme;
  const cssColor = (c: string) => (c === "ink" ? inkFor(theme) : c);

  // ---- Tabs ----
  // Canvas tabs are session-only (drawings live in memory). The first one is permanent.
  // Portfolio tabs come from portfolio.ts and can't be closed.
  const [canvases, setCanvases] = useState<CanvasTab[]>([{ id: "c1", name: "Canvas" }]);
  const [activeTab, setActiveTab] = useState("c1");
  const dataRef = useRef<Map<string, TabData>>(new Map([["c1", { ops: [], cursor: 0 }]]));
  const activeCanvasRef = useRef("c1"); // which canvas the drawing surface is showing
  const nextIdRef = useRef(2);
  const counterRef = useRef(1);
  const onCanvas = !activeTab.startsWith("p:");

            // ---------- Save / copy the canvas as a picture ----------
            const shotCountRef = useRef(1);
            const shotTimerRef = useRef(0);
            const [shotMode, setShotMode] = useState<"download" | "clipboard">("download");
            const [shotMenu, setShotMenu] = useState(false);
            const [shotNote, setShotNote] = useState("");
            const flashNote = (t: string) => {
              setShotNote(t);
              window.clearTimeout(shotTimerRef.current);
              shotTimerRef.current = window.setTimeout(() => setShotNote(""), 2200);
            };
            // Builds the picture: page background, then your drawing, then the greeting letters where they are right now.
            const makeShot = (): Promise<Blob | null> => {
              const canvas = canvasRef.current;
              if (!canvas) return Promise.resolve(null);
              const dpr = canvas.width / window.innerWidth;
              const top = Math.round(barH * dpr); // leave out the strip under the tab bar
              const out = document.createElement("canvas");
              out.width = canvas.width;
              out.height = canvas.height - top;
              const c = out.getContext("2d");
              if (!c) return Promise.resolve(null);
              const bg = getComputedStyle(canvas.closest("main") ?? document.body).getPropertyValue("--bg").trim() || "#0b0b0f";
              c.fillStyle = bg;
              c.fillRect(0, 0, out.width, out.height);
              c.drawImage(canvas, 0, top, canvas.width, canvas.height - top, 0, 0, out.width, out.height);
              c.save();
              c.scale(dpr, dpr);
              c.translate(0, -barH);
              textRef.current?.querySelectorAll<HTMLElement>("[data-char]").forEach((el) => {
                const r = el.getBoundingClientRect();
                const st = getComputedStyle(el);
                const m = new DOMMatrix(st.transform === "none" ? undefined : st.transform);
                c.save();
                c.translate(r.left + r.width / 2, r.top + r.height / 2);
                c.rotate(Math.atan2(m.b, m.a));
                c.font = st.fontWeight + " " + st.fontSize + " " + st.fontFamily;
                c.fillStyle = st.color;
                c.textAlign = "center";
                c.textBaseline = "middle";
                c.fillText(el.textContent ?? "", 0, 0);
                c.restore();
              });
              c.restore();
              return new Promise((res) => out.toBlob(res, "image/png"));
            };
            const takeShot = async () => {
              setShotMenu(false);
              try {
                if (shotMode === "clipboard") {
                  const item = new ClipboardItem({ "image/png": makeShot().then((b) => b as Blob) });
                  await navigator.clipboard.write([item]);
                  flashNote("Copied to clipboard");
                  return;
                }
                const blob = await makeShot();
                if (!blob) throw new Error("no picture");
                const name = SHOT_PREFIX + shotCountRef.current + ".png";
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 2000);
                shotCountRef.current += 1;
                flashNote("Saved " + name);
              } catch {
                flashNote(shotMode === "clipboard" ? "Copy was blocked. Try Download." : "Couldn't save the picture");
              }
            };

  const onCanvasRef = useRef(true);
  onCanvasRef.current = onCanvas;

  const [brush, setBrush] = useState<Brush>({ color: "#48dbfb", style: "solid", size: 8 });
  const [menu, setMenu] = useState<{ x: number; y: number; touch: boolean } | null>(null);
  const [sub, setSub] = useState<"brush" | "color" | null>(null);
  const [touchUI, setTouchUI] = useState(false); // true once the last tap came from a finger
  const [hist, setHist] = useState({ undo: false, redo: false });

  const brushRef = useRef(brush);
  brushRef.current = brush;
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menu !== null;

  // Load saved theme (or follow the system setting the first time)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("dnhn-theme");
      if (saved === "light" || saved === "dark") {
        setTheme(saved);
        return;
      }
    } catch {
      // storage unavailable, ignore
    }
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light");
    }
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("dnhn-theme", next);
    } catch {
      // ignore
    }
  };

  // Keep the cursor ring in sync with brush settings
  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;
    const d = Math.max(brush.size * (brush.style === "eraser" ? 1.5 : 1), 6);
    ring.style.width = d + "px";
    ring.style.height = d + "px";
    ring.style.borderColor = brush.style === "eraser" ? inkFor(theme) : cssColor(brush.color);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brush, theme]);

  // Hide the cursor ring while the pie menu is open
  useEffect(() => {
    if (menu && ringRef.current) ringRef.current.style.opacity = "0";
  }, [menu]);

  // ---------- Text physics ----------
  useEffect(() => {
    const container = textRef.current;
    if (!container) return;

    const particles: Particle[] = Array.from(
      container.querySelectorAll<HTMLElement>("[data-char]")
    ).map((el) => ({ el, restX: 0, restY: 0, x: 0, y: 0, vx: 0, vy: 0 }));

    const mouse = { x: -9999, y: -9999 };

    const measure = () => {
      for (const p of particles) {
        const r = p.el.getBoundingClientRect();
        p.restX = r.left + r.width / 2 - p.x;
        p.restY = r.top + r.height / 2 - p.y;
      }
    };
    measure();
    if (document.fonts) {
      document.fonts.ready.then(measure);
    }
    window.addEventListener("resize", measure);

    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") onLeave();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onMove);
    window.addEventListener("pointerup", onUp);
    document.addEventListener("pointerleave", onLeave);

    let raf = 0;
    const tick = () => {
      for (const p of particles) {
        const cx = p.restX + p.x;
        const cy = p.restY + p.y;
        const dx = cx - mouse.x;
        const dy = cy - mouse.y;
        const dist = Math.hypot(dx, dy);

        if (dist < RADIUS && dist > 0.001) {
          const falloff = 1 - dist / RADIUS;
          const force = falloff * falloff * PUSH;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }

        p.vx += -p.x * SPRING;
        p.vy += -p.y * SPRING;
        p.vx *= DAMPING;
        p.vy *= DAMPING;
        p.x += p.vx;
        p.y += p.vy;

        const mag = Math.hypot(p.x, p.y);
        if (mag > MAX_OFFSET) {
          p.x = (p.x / mag) * MAX_OFFSET;
          p.y = (p.y / mag) * MAX_OFFSET;
        }

        const rot = p.x * 0.4;
        p.el.style.transform =
          "translate3d(" + p.x + "px, " + p.y + "px, 0) rotate(" + rot + "deg)";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointerleave", onLeave);
    };
    // Re-run whenever the text changes so every letter gets its own physics
  }, [shown]);

  // ---------- Drawing, selection, undo / redo ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ink = () => inkFor(themeRef.current);

    let current: StrokeOp | null = null;
    let drawing = false;
    let marquee: Rect | null = null;
    let moving: { x0: number; y0: number; dx: number; dy: number } | null = null;
    let liveRaf = 0;
    let snap: HTMLCanvasElement | null = null; // the canvas as it was before the current stroke
    let lpTimer = 0; // long-press timer (touch)
    let lpStart: Pt | null = null;
    let lastPtype = "mouse";

    const setSelection = (s: Selection | null) => {
      selRef.current = s;
      setSel(s);
    };

    // History of the canvas tab being shown. Stored as strokes, so it survives resizing.
    const cur = (): TabData => {
      let d = dataRef.current.get(activeCanvasRef.current);
      if (!d) {
        d = { ops: [], cursor: 0 };
        dataRef.current.set(activeCanvasRef.current, d);
      }
      return d;
    };

    const sync = () => {
      const d = cur();
      setHist({ undo: d.cursor > 0, redo: d.cursor < d.ops.length });
    };

    const wipe = () => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    };

    // Replays history up to the cursor: which strokes exist, and where they are now.
    const resolve = () => {
      const d = cur();
      let start = 0;
      for (let i = d.cursor - 1; i >= 0; i--) {
        if (d.ops[i].kind === "clear") {
          start = i + 1;
          break;
        }
      }
      const strokes: StrokeOp[] = [];
      const offsets = new Map<number, Pt>();
      const gone = new Set<number>();
      for (let i = start; i < d.cursor; i++) {
        const op = d.ops[i];
        if (op.kind === "stroke") {
          strokes.push(op);
        } else if (op.kind === "move") {
          for (const id of op.ids) {
            const o = offsets.get(id) ?? { x: 0, y: 0 };
            offsets.set(id, { x: o.x + op.dx, y: o.y + op.dy });
          }
        } else if (op.kind === "delete") {
          for (const id of op.ids) gone.add(id);
        }
      }
      const out: { s: StrokeOp; ox: number; oy: number }[] = [];
      for (const s of strokes) {
        if (gone.has(s.id)) continue;
        const o = offsets.get(s.id);
        out.push({ s, ox: o ? o.x : 0, oy: o ? o.y : 0 });
      }
      return out;
    };

    const redraw = (live?: { ids: Set<number>; dx: number; dy: number }) => {
      wipe();
      const col = ink();
      for (const { s, ox, oy } of resolve()) {
        const moved = !!live && live.ids.has(s.id);
        const X = ox + (moved && live ? live.dx : 0);
        const Y = oy + (moved && live ? live.dy : 0);
        if (X !== 0 || Y !== 0) {
          ctx.save();
          ctx.translate(X, Y);
          paintStroke(ctx, s.brush, s.pts, s.seed, col);
          ctx.restore();
        } else {
          paintStroke(ctx, s.brush, s.pts, s.seed, col);
        }
      }
    };

    // Live drawing: put back the picture from before the stroke, then paint the whole stroke
    const takeSnapshot = () => {
      if (!snap) snap = document.createElement("canvas");
      if (snap.width !== canvas.width || snap.height !== canvas.height) {
        snap.width = canvas.width;
        snap.height = canvas.height;
      }
      const sctx = snap.getContext("2d");
      if (!sctx) return;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, snap.width, snap.height);
      sctx.drawImage(canvas, 0, 0);
    };

    const paintLive = () => {
      if (!current || !snap) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(snap, 0, 0);
      ctx.restore();
      paintStroke(ctx, current.brush, current.pts, current.seed, ink());
    };

    // Strokes that would draw nothing (e.g. a click with the line brush) aren't kept
    const strokeIsEmpty = (st: StrokeOp) => {
      const n = st.pts.length;
      const s = st.brush.style;
      if (s === "line") {
        return n < 2 || Math.hypot(st.pts[1].x - st.pts[0].x, st.pts[1].y - st.pts[0].y) < 1;
      }
      if (s === "dashed" || s === "double") return n < 2;
      return false;
    };

    const commit = (op: Op) => {
      const d = cur();
      d.ops.length = d.cursor; // drop any redo history
      d.ops.push(op);
      d.cursor = d.ops.length;
      sync();
    };

    // ----- Angle gizmo for the straight-line brush -----
    const GZ_LEN = 96;
    const GZ_R = 28;
    const gz = (name: string) =>
      gizmoRef.current ? gizmoRef.current.querySelector('[data-gz="' + name + '"]') : null;

    const hideGizmo = () => {
      if (gizmoRef.current) gizmoRef.current.style.display = "none";
    };

    const showGizmo = (o: Pt, s: { len: number; ux: number; uy: number }) => {
      const g = gizmoRef.current;
      if (!g) return;
      g.style.display = "block";
      const bx = s.ux >= 0 ? 1 : -1; // which way the horizontal reference points
      const phi = Math.round((Math.acos(Math.min(1, Math.abs(s.ux))) * 180) / Math.PI);
      const r = Math.min(GZ_R, Math.max(10, s.len * 0.45));

      const base = gz("base");
      const grad = gz("grad");
      const dot = gz("dot");
      const arc = gz("arc");
      const label = gz("label");
      if (!base || !grad || !dot || !arc || !label) return;

      const x2 = o.x + bx * GZ_LEN;
      base.setAttribute("x1", String(o.x));
      base.setAttribute("y1", String(o.y));
      base.setAttribute("x2", String(x2));
      base.setAttribute("y2", String(o.y));
      grad.setAttribute("x1", String(o.x));
      grad.setAttribute("y1", String(o.y));
      grad.setAttribute("x2", String(x2));
      grad.setAttribute("y2", String(o.y));
      dot.setAttribute("cx", String(o.x));
      dot.setAttribute("cy", String(o.y));

      if (phi === 0) {
        arc.setAttribute("d", "");
      } else {
        const sweep = bx * s.uy > 0 ? 1 : 0;
        arc.setAttribute(
          "d",
          "M" + (o.x + bx * r) + " " + o.y + " A" + r + " " + r + " 0 0 " + sweep + " " + (o.x + s.ux * r) + " " + (o.y + s.uy * r)
        );
      }

      // Put the number on the far side of the reference line from the drawn line, so the
      // two never overlap
      const side = s.uy > 0 ? -1 : 1;
      label.setAttribute("x", String(o.x + bx * (r + 22)));
      label.setAttribute("y", String(o.y + side * 13));
      label.textContent = phi + "°";
    };

    // ----- Selection helpers -----
    // Strokes that touch the rectangle. Erasers ride along (so erased gaps move with the
    // drawing) but never count as a selection on their own.
    const pickIn = (r: Rect) => {
      const ids: number[] = [];
      let anyInk = false;
      for (const { s, ox, oy } of resolve()) {
        const pad = strokePad(s.brush);
        const box = { x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad };
        let hit = false;
        const first = { x: s.pts[0].x + ox, y: s.pts[0].y + oy };
        if (s.pts.length === 1) hit = segHitsRect(first, first, box);
        for (let j = 1; j < s.pts.length && !hit; j++) {
          const a = { x: s.pts[j - 1].x + ox, y: s.pts[j - 1].y + oy };
          const b = { x: s.pts[j].x + ox, y: s.pts[j].y + oy };
          hit = segHitsRect(a, b, box);
        }
        if (hit) {
          ids.push(s.id);
          if (s.brush.style !== "eraser") anyInk = true;
        }
      }
      return anyInk ? ids : [];
    };

    // Box around the selected strokes (based on visible ink, not invisible eraser paths)
    const boundsFor = (ids: number[]) => {
      const want = new Set(ids);
      const items = resolve().filter(({ s }) => want.has(s.id));
      const inkItems = items.filter(({ s }) => s.brush.style !== "eraser");
      const use = inkItems.length ? inkItems : items;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const { s, ox, oy } of use) {
        const pad = strokePad(s.brush);
        for (const p of s.pts) {
          x0 = Math.min(x0, p.x + ox - pad);
          y0 = Math.min(y0, p.y + oy - pad);
          x1 = Math.max(x1, p.x + ox + pad);
          y1 = Math.max(y1, p.y + oy + pad);
        }
      }
      if (!isFinite(x0)) return null;
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };

    const showMarquee = () => {
      const el = marqueeRef.current;
      if (!el) return;
      if (!marquee) {
        el.style.display = "none";
        return;
      }
      const x = Math.min(marquee.x0, marquee.x1);
      const y = Math.min(marquee.y0, marquee.y1);
      el.style.display = "block";
      el.style.transform = "translate(" + x + "px, " + y + "px)";
      el.style.width = Math.abs(marquee.x1 - marquee.x0) + "px";
      el.style.height = Math.abs(marquee.y1 - marquee.y0) + "px";
    };

    // While dragging a selection, repaint with a temporary offset (committed on release)
    const scheduleLive = () => {
      if (liveRaf) return;
      liveRaf = requestAnimationFrame(() => {
        liveRaf = 0;
        const s = selRef.current;
        if (!moving || !s) return;
        redraw({ ids: new Set(s.ids), dx: moving.dx, dy: moving.dy });
        const box = selBoxRef.current;
        if (box) box.style.transform = "translate(" + moving.dx + "px, " + moving.dy + "px)";
      });
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    };
    resize();
    window.addEventListener("resize", resize);

    actionsRef.current = {
      undo: () => {
        const d = cur();
        if (current || moving || d.cursor === 0) return;
        d.cursor -= 1;
        setSelection(null);
        redraw();
        sync();
      },
      redo: () => {
        const d = cur();
        if (current || moving || d.cursor >= d.ops.length) return;
        d.cursor += 1;
        setSelection(null);
        redraw();
        sync();
      },
      clear: () => {
        if (current || moving) return;
        commit({ kind: "clear" });
        setSelection(null);
        redraw();
      },
      refresh: () => {
        redraw();
        sync();
      },
      deselect: () => setSelection(null),
      deleteSelection: () => {
        const s = selRef.current;
        if (!s || current || moving) return;
        commit({ kind: "delete", ids: s.ids });
        setSelection(null);
        redraw();
      },
    };

    // ----- Opening the pie menu / the text editor -----
    const textHit = (x: number, y: number) => {
      const box = textRef.current ? textRef.current.getBoundingClientRect() : null;
      const slack = 10;
      return (
        !!box &&
        x >= box.left - slack &&
        x <= box.right + slack &&
        y >= box.top - slack &&
        y <= box.bottom + slack
      );
    };

    const openAt = (x: number, y: number, touch: boolean) => {
      if (textHit(x, y)) {
        startEditRef.current(); // right-click / long-press on the greeting edits it
        return;
      }
      const R = touch ? PIE_R_TOUCH : PIE_R;
      const mx = Math.min(Math.max(x, R), Math.max(window.innerWidth - R, R));
      const my = Math.min(Math.max(y, R), Math.max(window.innerHeight - R, R));
      setSub(null);
      setMenu({ x: mx, y: my, touch });
    };

    // Abandon whatever stroke / drag is in progress without keeping it
    const discardInteraction = () => {
      const had = drawing || !!current || !!moving || !!marquee;
      drawing = false;
      current = null;
      moving = null;
      marquee = null;
      showMarquee();
      hideGizmo();
      const box = selBoxRef.current;
      if (box) box.style.transform = "";
      if (had) redraw();
    };

    const cancelLongPress = () => {
      if (lpTimer) window.clearTimeout(lpTimer);
      lpTimer = 0;
    };

    const fireLongPress = () => {
      lpTimer = 0;
      const p = lpStart;
      lpStart = null;
      if (!p) return;
      discardInteraction(); // the tap that started the long press isn't a stroke
      if (editingRef.current) return;
      openGestureRef.current = true;
      openAt(p.x, p.y, true);
    };

    // ----- Pointer handlers -----
    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0 || e.ctrlKey || menuOpenRef.current || !onCanvasRef.current) return;
      if (editingRef.current) return; // first click while editing text just finishes the edit
      const p = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);

      if (e.pointerType === "touch") {
        cancelLongPress();
        lpStart = p;
        lpTimer = window.setTimeout(fireLongPress, LONG_PRESS_MS);
      }

      if (toolRef.current === "select") {
        const s = selRef.current;
        if (s && p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) {
          moving = { x0: p.x, y0: p.y, dx: 0, dy: 0 };
        } else {
          setSelection(null);
          marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
          showMarquee();
        }
        return;
      }

      drawing = true;
      const seed = Math.floor(Math.random() * 2147483647);
      const b = { ...brushRef.current };
      strokeIdRef.current += 1;
      current = { kind: "stroke", id: strokeIdRef.current, brush: b, seed, pts: [p] };
      takeSnapshot();
      paintLive();
    };

    const onMove = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      const p = { x: e.clientX, y: e.clientY };
      const isSelect = toolRef.current === "select";
      if (lpTimer && lpStart && Math.hypot(p.x - lpStart.x, p.y - lpStart.y) > LONG_PRESS_SLOP) {
        cancelLongPress(); // finger moved: it's a stroke, not a long press
      }

      const ring = ringRef.current;
      if (ring) {
        ring.style.transform = "translate(" + p.x + "px, " + p.y + "px) translate(-50%, -50%)";
        const overBar = !!tabBarRef.current && tabBarRef.current.contains(e.target as Node);
        const hide =
          menuOpenRef.current ||
          overBar ||
          !onCanvasRef.current ||
          isSelect ||
          editingRef.current ||
          e.pointerType === "touch";
        ring.style.opacity = hide ? "0" : "1";
      }

      if (moving) {
        moving.dx = p.x - moving.x0;
        moving.dy = p.y - moving.y0;
        scheduleLive();
        return;
      }
      if (marquee) {
        marquee.x1 = p.x;
        marquee.y1 = p.y;
        showMarquee();
        return;
      }
      if (isSelect) {
        const s = selRef.current;
        const inside = !!s && p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
        canvas.style.cursor = inside ? "move" : "crosshair";
        return;
      }

      if (!drawing || !current) return;
      if (current.brush.style === "line") {
        const o = current.pts[0];
        const s = snapLine(o, p);
        current.pts = [o, s.pt];
        showGizmo(o, s);
        paintLive();
        return;
      }
      const last = current.pts[current.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 0.5) {
        current.pts.push(p);
        paintLive();
      }
    };

    const onUp = () => {
      cancelLongPress();
      lpStart = null;
      drawing = false;
      hideGizmo();
      if (current) {
        const st = current;
        current = null;
        if (strokeIsEmpty(st)) redraw();
        else commit(st);
      }

      if (moving) {
        const m = moving;
        moving = null;
        const s = selRef.current;
        const box = selBoxRef.current;
        if (box) box.style.transform = "";
        if (s && Math.hypot(m.dx, m.dy) >= 1) {
          commit({ kind: "move", ids: s.ids, dx: m.dx, dy: m.dy });
          setSelection({ ...s, x: s.x + m.dx, y: s.y + m.dy });
        }
        redraw();
      }

      if (marquee) {
        const r = marquee;
        marquee = null;
        showMarquee();
        const rect = {
          x0: Math.min(r.x0, r.x1),
          y0: Math.min(r.y0, r.y1),
          x1: Math.max(r.x0, r.x1),
          y1: Math.max(r.y0, r.y1),
        };
        // A tiny drag is just a click: it only clears the selection
        if (rect.x1 - rect.x0 >= 3 || rect.y1 - rect.y0 >= 3) {
          const ids = pickIn(rect);
          const b = ids.length ? boundsFor(ids) : null;
          if (b) setSelection({ ids, x: b.x, y: b.y, w: b.w, h: b.h });
        }
      }
    };

    // Scroll to change thickness: 1px per step, with a cooldown so trackpad momentum
    // can't run away. Tune WHEEL_STEP / WHEEL_COOLDOWN at the top of the file.
    let wheelAcc = 0;
    let lastStepAt = 0;
    const onWheel = (e: WheelEvent) => {
      if (!onCanvasRef.current) return; // let portfolio tabs scroll normally
      if (tabBarRef.current && tabBarRef.current.contains(e.target as Node)) return;
      e.preventDefault();
      if (editingRef.current || toolRef.current === "select") return;
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      wheelAcc += e.deltaY * unit;
      if (Math.abs(wheelAcc) < WHEEL_STEP) return;
      const now = performance.now();
      if (now - lastStepAt < WHEEL_COOLDOWN) {
        wheelAcc = 0; // throw away extra distance instead of banking it
        return;
      }
      lastStepAt = now;
      const dir = wheelAcc < 0 ? 1 : -1; // scroll up = thicker
      wheelAcc = 0;
      setBrush((b) => ({ ...b, size: Math.min(80, Math.max(1, b.size + dir)) }));
    };

    const onContext = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === "TEXTAREA") return; // normal browser menu while typing
      if (tabBarRef.current && tabBarRef.current.contains(target as Node)) {
        e.preventDefault();
        return;
      }
      if (!onCanvasRef.current) return; // normal browser menu on portfolio tabs
      e.preventDefault();

      if (lastPtype === "touch") {
        // Some phones also send a context-menu event after a long press. Our own
        // long-press timer normally got there first, so only act if it hasn't.
        if (!menuOpenRef.current && !editingRef.current) {
          cancelLongPress();
          discardInteraction();
          openAt(e.clientX, e.clientY, true);
        }
        return;
      }

      onUp(); // finish any stroke / selection drag in progress
      openAt(e.clientX, e.clientY, false);
    };

    const onGlobalUp = () => {
      if (!openGestureRef.current) return;
      // the browser fires a click right after the release; let it pass before the menu is live
      window.setTimeout(() => {
        openGestureRef.current = false;
      }, 150);
    };

    const onGlobalDown = (e: PointerEvent) => {
      lastPtype = e.pointerType;
      setTouchUI(e.pointerType === "touch");
      const m = menuRef.current;
      if (m && !m.contains(e.target as Node)) setMenu(null);
    };

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "TEXTAREA" ||
          (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "color") ||
          t.isContentEditable);
      if (typing) return; // let the text box handle its own keys

      if (e.key === "Escape") {
        if (menuOpenRef.current) setMenu(null);
        else if (selRef.current) setSelection(null);
        else if (toolRef.current === "select") setTool("draw");
        return;
      }
      if (!onCanvasRef.current) return;

      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === "z") {
          e.preventDefault();
          if (e.shiftKey) actionsRef.current.redo();
          else actionsRef.current.undo();
        } else if (k === "y") {
          e.preventDefault();
          actionsRef.current.redo();
        }
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selRef.current) {
          e.preventDefault();
          actionsRef.current.deleteSelection();
        }
        return;
      }

      const k = e.key.toLowerCase();
      if (k === "v") setTool("select"); // V = select tool
      else if (k === "b") setTool("draw"); // B = brush
      else if (e.key === "[") setBrush((b) => ({ ...b, size: Math.max(1, b.size - 1) }));
      else if (e.key === "]") setBrush((b) => ({ ...b, size: Math.min(80, b.size + 1) }));
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("pointerdown", onGlobalDown);
    window.addEventListener("pointerup", onGlobalUp);
    window.addEventListener("pointercancel", onGlobalUp);
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(liveRaf);
      cancelLongPress();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("pointerdown", onGlobalDown);
      window.removeEventListener("pointerup", onGlobalUp);
      window.removeEventListener("pointercancel", onGlobalUp);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Repaint when the theme changes so "ink" strokes switch color
  useEffect(() => {
    actionsRef.current.refresh();
  }, [theme]);

  // Switching tools: crosshair + no brush ring for select; leaving select drops the selection
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = tool === "select" ? "crosshair" : "";
    if (tool === "select") {
      if (ringRef.current) ringRef.current.style.opacity = "0";
    } else {
      actionsRef.current.deselect();
    }
  }, [tool]);

  // ---------- Tab actions ----------
  const selectTab = (id: string) => {
    setActiveTab(id);
    setMenu(null);
    actionsRef.current.deselect();
    if (!id.startsWith("p:")) {
      activeCanvasRef.current = id;
      actionsRef.current.refresh();
    }
  };

  const addCanvas = () => {
    const id = "c" + nextIdRef.current;
    nextIdRef.current += 1;
    counterRef.current += 1;
    dataRef.current.set(id, { ops: [], cursor: 0 });
    setCanvases((list) => [...list, { id, name: "Canvas " + counterRef.current }]);
    selectTab(id);
  };

  const closeCanvas = (id: string) => {
    if (id === "c1") return;
    const d = dataRef.current.get(id);
    if (d && d.cursor > 0 && !window.confirm("Close this canvas? Its drawing will be lost.")) {
      return;
    }
    const idx = canvases.findIndex((c) => c.id === id);
    if (idx < 1) return;
    const fallback = canvases[idx - 1].id;
    dataRef.current.delete(id);
    setCanvases(canvases.filter((c) => c.id !== id));
    if (activeTab === id) {
      selectTab(fallback);
    } else if (activeCanvasRef.current === id) {
      activeCanvasRef.current = fallback;
      actionsRef.current.deselect();
      actionsRef.current.refresh();
    }
  };

  // ---------- Pie menu content ----------
  const close = () => setMenu(null);

  const mainSlices: Slice[] = [
    {
      id: "brush",
      icon: "✎",
      label: "Brush",
      active: sub === "brush",
      onSelect: () => setSub((s) => (s === "brush" ? null : "brush")),
    },
    {
      id: "color",
      icon: "●",
      iconColor: cssColor(brush.color),
      label: "Color",
      active: sub === "color",
      onSelect: () => setSub((s) => (s === "color" ? null : "color")),
    },
    {
      id: "select",
      icon: "⬚",
      label: "Select",
      active: tool === "select",
      onSelect: () => {
        setTool((t) => (t === "select" ? "draw" : "select"));
        close();
      },
    },
    {
      id: "undo",
      icon: "↶",
      label: "Undo",
      disabled: !hist.undo,
      onSelect: () => actionsRef.current.undo(),
    },
    {
      id: "redo",
      icon: "↷",
      label: "Redo",
      disabled: !hist.redo,
      onSelect: () => actionsRef.current.redo(),
    },
    {
      id: "clear",
      icon: "✕",
      label: "Clear",
      onSelect: () => {
        actionsRef.current.clear();
        close();
      },
    },
  ];

  const brushSlices: Slice[] = STYLES.map((s) => ({
    id: s.id,
    label: s.label,
    active: brush.style === s.id,
    onSelect: () => {
      setBrush((b) => ({ ...b, style: s.id }));
      setTool("draw");
      close();
    },
  }));

  const colorSlices: Slice[] = [
    ...COLORS.map((c) => ({
      id: c,
      label: "",
      fill: cssColor(c),
      active: brush.color === c,
      onSelect: () => {
        setBrush((b) => ({ ...b, color: c, style: b.style === "eraser" ? "solid" : b.style }));
        setTool("draw");
        close();
      },
    })),
    {
      id: "custom",
      label: "+",
      onSelect: () => {
        const input = colorInputRef.current;
        if (input && menu) {
          input.style.left = menu.x + "px";
          input.style.top = menu.y + "px";
          input.click();
        }
        close();
      },
    },
  ];

  const previewR = Math.min(Math.max(brush.size / 2, 2), 20);
  const portfolioTab = PORTFOLIO.find((p) => "p:" + p.id === activeTab);

  // Pie menu helpers
  const pieR = menu && menu.touch ? PIE_R_TOUCH : PIE_R;
  const centerPreview =
    brush.style === "eraser" ? (
      <circle
        className="pie-text"
        r={previewR}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeDasharray="3 3"
        style={{ pointerEvents: "none", stroke: "var(--fg)", fill: "none" }}
      />
    ) : (
      <circle r={previewR} style={{ pointerEvents: "none", fill: cssColor(brush.color) }} />
    );

  // Thickness slider (touch): thin on the left end of the half circle, thick on the right end
  const sliderAng = Math.PI * (1 - (brush.size - 1) / 79);
  const thumbX = TOUCH_SLIDER_R * Math.cos(sliderAng);
  const thumbY = TOUCH_SLIDER_R * Math.sin(sliderAng);
  const setSizeFromPointer = (e: { clientX: number; clientY: number }) => {
    if (!menu) return;
    const dx = e.clientX - menu.x;
    const dy = e.clientY - menu.y;
    let a = Math.atan2(dy, dx); // the lower half of the circle is 0 .. PI
    if (a < 0) a = dx < 0 ? Math.PI : 0; // finger above the middle: snap to the nearer end
    const t = 1 - a / Math.PI;
    const size = Math.min(80, Math.max(1, Math.round(1 + t * 79)));
    setBrush((b) => ({ ...b, size }));
  };

  const canvasTabEl = (c: CanvasTab) => {
    const permanent = c.id === "c1";
    return (
      <div
        key={c.id}
        className={
          "tab-item clickable" + (activeTab === c.id ? " active" : "") + (permanent ? "" : " closable")
        }
        onClick={() => selectTab(c.id)}
      >
        {c.name}
        {!permanent && (
          <span
            className="tab-x clickable"
            title="Close canvas"
            onClick={(e) => {
              e.stopPropagation();
              closeCanvas(c.id);
            }}
          >
            ×
          </span>
        )}
      </div>
    );
  };

  return (
    <main
      data-theme={theme}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg)",
        color: "var(--fg)",
        overflow: "hidden",
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        touchAction: "none",
        colorScheme: theme,
      }}
    >
      <style>{`
        main[data-theme="dark"] {
          --bg: #0b0b0f; --fg: #f5f5f7; --muted: rgba(245,245,247,0.6);
          --panel: rgba(255,255,255,0.06); --border: rgba(255,255,255,0.13);
          --bar: rgba(16,16,22,0.96); --ph: #26262d;
          --pie-bg: rgba(28,28,36,0.95); --pie-hover: rgba(78,78,104,0.98);
        }
        main[data-theme="light"] {
          --bg: #f4f4f1; --fg: #16161d; --muted: rgba(22,22,29,0.6);
          --panel: rgba(0,0,0,0.05); --border: rgba(0,0,0,0.14);
          --bar: rgba(250,250,247,0.96); --ph: #d9d9d6;
          --pie-bg: rgba(255,255,255,0.96); --pie-hover: rgba(222,222,232,0.98);
        }

        /* Custom cursors (files live in public/cursors). Numbers = hotspot x y. */
        main {
          --cursor-default: url("/cursors/cursor.png") 3 28, auto;
          --cursor-hover: url("/cursors/cursor-hover.png") 4 28, pointer;
          --cursor-pressed: url("/cursors/cursor-pressed.png") 3 28, pointer;
          cursor: var(--cursor-default);
        }
        main * { cursor: inherit; }
        main .clickable { cursor: var(--cursor-hover); }
        main .clickable:active { cursor: var(--cursor-pressed); }

        @keyframes pieIn {
          from { opacity: 0; transform: scale(0.7); }
          to { opacity: 1; transform: scale(1); }
        }
        .pie-dark { fill: var(--pie-bg); stroke: var(--border); stroke-width: 1; transition: fill 0.12s; }
        .pie-dark:hover { fill: var(--pie-hover); }
        .pie-color { stroke: var(--border); stroke-width: 1; transition: filter 0.12s; }
        .pie-color:hover { filter: brightness(1.18); }
        .pie-active { stroke: var(--fg) !important; stroke-width: 2.5 !important; }
        .pie-text { fill: var(--fg); }
        .pie-center { fill: var(--pie-bg); stroke: var(--border); stroke-width: 1; }

        .tabbar { display: flex; align-items: flex-end; height: ${TAB_BAR_H}px; padding: 0 10px; }
        .tab-scroll { display: flex; align-items: flex-end; gap: 3px; flex: 1; min-width: 0; height: 100%; overflow-x: auto; scrollbar-width: none; }
        .tab-scroll::-webkit-scrollbar { display: none; }
        
        .theme-btn { align-self: center; }
        .tab-tools { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-left: 10px; flex: none; align-self: center; }
        .tl-icon { order: 0; }
        .tl-main { order: 1; }

        /* Phones: tabs wrap onto as many lines as they need instead of scrolling sideways */
        @media (max-width: 700px) {
          .tabbar { height: auto; min-height: ${TAB_BAR_H}px; align-items: flex-start; padding: 6px 10px; }
          .tab-scroll { flex-wrap: wrap; height: auto; overflow: visible; align-items: center; gap: 4px; }
          .tab-item { height: 28px; border-radius: 8px; border-bottom: 1px solid transparent; }
          .tab-sep { display: none; }
          
          .tab-tools { flex-wrap: wrap; max-width: 42%; align-self: flex-start; margin-left: 8px; }
          .tl-main { order: 0; }
          .tl-icon { order: 1; }
        }
        .tab-item {
          display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 14px;
          border-radius: 8px 8px 0 0; font-size: 13px; white-space: nowrap; flex-shrink: 0;
          color: var(--muted); border: 1px solid transparent; border-bottom: none;
        }
        .tab-item.closable { padding-right: 8px; }
        .tab-item:hover { background: var(--panel); }
        .tab-item.active { background: var(--bg); color: var(--fg); border-color: var(--border); }
        .tab-x {
          width: 18px; height: 18px; border-radius: 4px; display: inline-flex;
          align-items: center; justify-content: center; font-size: 14px; line-height: 1; opacity: 0.5;
        }
        .tab-x:hover { opacity: 1; background: var(--border); }
        .tab-sep { width: 1px; height: 16px; background: var(--border); align-self: center; margin: 0 4px; flex-shrink: 0; }
        .icon-btn {
          width: 28px; height: 28px; border-radius: 8px; border: none; padding: 0; flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
          background: var(--panel); color: var(--fg);
        }
        .icon-btn:hover { background: var(--border); }
      `}</style>

      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          visibility: onCanvas ? "visible" : "hidden",
          WebkitTouchCallout: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      />

      {/* Greeting in the top-left corner. Right-click it to edit. Only visible on canvas tabs,
          and doesn't block drawing. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: barH,
          padding: "20px 36px",
          pointerEvents: "none",
          zIndex: 1,
          opacity: onCanvas ? 1 : 0,
          transition: "opacity 0.2s",
        }}
      >
        <div
          ref={textRef}
          style={{
            position: "relative",
            display: "flex",
            flexWrap: "wrap",
            columnGap: "0.28em",
            maxWidth: "min(1100px, calc(100vw - 72px))",
            minWidth: "2ch",
            minHeight: "1.1em",
            fontSize: "clamp(2.25rem, 5.2vw, 4.5rem)",
            fontWeight: 700,
            lineHeight: 1.1,
            userSelect: "none",
          }}
        >
          {shown.split("\n").map((line, li) => (
            <Fragment key={li}>
              {li > 0 && <span style={{ flexBasis: "100%", height: 0 }} />}
              {line
                .split(/\s+/)
                .filter(Boolean)
                .map((word, wi) => (
                  <span key={wi} style={{ display: "inline-flex", whiteSpace: "nowrap" }}>
                    {Array.from(word).map((ch, ci) => (
                      <span
                        key={ci}
                        data-char
                        style={{
                          display: "inline-block",
                          willChange: "transform",
                          visibility: editing ? "hidden" : "visible",
                        }}
                      >
                        {ch}
                      </span>
                    ))}
                  </span>
                ))}
            </Fragment>
          ))}

          {editing && (
            <>
              <textarea
                ref={taRef}
                value={draft}
                maxLength={GREETING_MAX_LENGTH}
                rows={1}
                spellCheck={false}
                aria-label="Edit greeting text"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    finishEdit(true);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    finishEdit(false);
                  }
                }}
                onBlur={() => finishEdit(true)}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  boxSizing: "border-box",
                  margin: 0,
                  padding: 0,
                  border: "none",
                  outline: "2px dashed var(--muted)",
                  outlineOffset: 8,
                  borderRadius: 4,
                  background: "transparent",
                  color: "inherit",
                  caretColor: "var(--fg)",
                  font: "inherit",
                  letterSpacing: "inherit",
                  resize: "none",
                  overflow: "hidden",
                  pointerEvents: "auto",
                  userSelect: "text",
                  WebkitUserSelect: "text",
                  cursor: "text",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: "calc(100% + 22px)",
                  fontSize: 12,
                  fontWeight: 400,
                  lineHeight: 1.4,
                  whiteSpace: "nowrap",
                  color: "var(--muted)",
                  pointerEvents: "none",
                }}
              >
                Enter to save · Shift+Enter for a new line · Esc to cancel
              </div>
            </>
          )}
        </div>
      </div>

      {/* Dashed box while dragging a selection */}
      <div
        ref={marqueeRef}
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          display: "none",
          border: "1.5px dashed var(--fg)",
          background: "rgba(72,219,251,0.12)",
          pointerEvents: "none",
          zIndex: 4,
        }}
      />

      {/* Box around the selected drawing (drag inside it to move, Delete to remove) */}
      {sel && tool === "select" && (
        <div
          ref={selBoxRef}
          style={{
            position: "fixed",
            left: sel.x,
            top: sel.y,
            width: sel.w,
            height: sel.h,
            border: "1.5px dashed var(--fg)",
            outline: "1px solid var(--bg)",
            pointerEvents: "none",
            zIndex: 4,
          }}
        >
          {/* On a touch screen there is no Delete key, so show a Delete button on the box */}
          {touchUI && (
            <button
              className="clickable"
              onClick={() => actionsRef.current.deleteSelection()}
              style={{
                position: "absolute",
                right: 0,
                ...(sel.y < 80 ? { top: "100%", marginTop: 10 } : { bottom: "100%", marginBottom: 10 }),
                pointerEvents: "auto",
                padding: "7px 14px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--bar)",
                color: "#ff5a5f",
                font: "inherit",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}

      {/* Portfolio view */}
      {portfolioTab && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: barH,
            bottom: 0,
            overflowY: "auto",
            padding: "28px 32px 64px",
            background: "var(--bg)",
            zIndex: 2,
            touchAction: "pan-y",
          }}
        >
          {portfolioTab.kind === "maps" ? (
            <Maps key={portfolioTab.id} tab={portfolioTab} topInset={barH} />
          ) : (
            <Bento key={portfolioTab.id} tab={portfolioTab} />
          )}
        </div>
      )}


            {/* Save / copy picture button (bottom-left, canvas tabs only) */}
            {onCanvas && (
        <>
          {shotMenu && <div style={{ position: "fixed", inset: 0, zIndex: 3 }} onPointerDown={() => setShotMenu(false)} />}
          <div
            onContextMenu={(e) => e.stopPropagation()}
            style={{ position: "fixed", left: 16, bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", zIndex: 4, display: "flex", alignItems: "center", gap: 2 }}
          >
            <button
              className="icon-btn clickable"
              onClick={takeShot}
              title={shotMode === "download" ? "Save the drawing as a picture" : "Copy the drawing as a picture"}
              aria-label="Capture the drawing"
              style={{ borderRadius: "8px 3px 3px 8px", border: "1px solid var(--border)" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                <circle cx="12" cy="13.5" r="3.5" />
              </svg>
            </button>
            <button
              className="icon-btn clickable"
              onClick={() => setShotMenu((o) => !o)}
              aria-label="Capture options"
              aria-expanded={shotMenu}
              style={{ width: 20, borderRadius: "3px 8px 8px 3px", border: "1px solid var(--border)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: shotMenu ? "none" : "rotate(180deg)" }}>
                <path d="M6 15l6-6 6 6" />
              </svg>
            </button>
            {shotMenu && (
              <div
                style={{
                  position: "absolute", left: 0, bottom: "calc(100% + 8px)", minWidth: 190, padding: 4, borderRadius: 10,
                  background: "var(--bar)", border: "1px solid var(--border)", backdropFilter: "blur(10px)", boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
                }}
              >
                {(["download", "clipboard"] as const).map((m) => (
                  <button
                    key={m}
                    className="clickable"
                    onClick={() => { setShotMode(m); setShotMenu(false); }}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", border: 0, borderRadius: 7, background: shotMode === m ? "var(--panel)" : "transparent", color: "var(--fg)", font: "inherit", fontSize: 13, textAlign: "left" }}
                  >
                    <span style={{ width: 14 }}>{shotMode === m ? "✓" : ""}</span>
                    {m === "download" ? "Download PNG" : "Copy to clipboard"}
                  </button>
                ))}
              </div>
            )}
            {shotNote && (
              <div style={{ position: "absolute", left: 0, bottom: "calc(100% + 8px)", padding: "6px 10px", borderRadius: 8, fontSize: 12, whiteSpace: "nowrap", background: "var(--bar)", border: "1px solid var(--border)", color: "var(--fg)", pointerEvents: "none" }}>
                {shotNote}
              </div>
            )}
          </div>
        </>
      )}

      {/* Tab bar */}
      <div
        ref={tabBarRef}
        className="tabbar"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          background: "var(--bar)",
          borderBottom: "1px solid var(--border)",
          zIndex: 6,
          userSelect: "none",
        }}
      >
        <div className="tab-scroll">
          {canvasTabEl(canvases[0])}

          {PORTFOLIO.length > 0 && <span className="tab-sep" />}
          {PORTFOLIO.map((p) => (
            <div
              key={p.id}
              className={"tab-item clickable" + (activeTab === "p:" + p.id ? " active" : "")}
              onClick={() => selectTab("p:" + p.id)}
            >
              {p.title}
            </div>
          ))}

          {canvases.length > 1 && <span className="tab-sep" />}
          {canvases.slice(1).map((c) => canvasTabEl(c))}

          <button
            className="icon-btn clickable"
            onClick={addCanvas}
            title="New canvas"
            style={{ alignSelf: "center", marginLeft: 4, fontSize: 16, lineHeight: 1 }}
          >
            +
          </button>
        </div>

        <div className="tab-tools">
        {ICON_LINKS.map((l) => (
          <a
            key={l.url + l.icon}
            className="icon-btn theme-btn tl-icon clickable"
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            title={l.label}
            aria-label={l.label}
            style={{ textDecoration: "none" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {l.icon === "instagram" ? (
                <>
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
                </>
              ) : l.icon === "email" ? (
                <>
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm0 0c0 1.657 1.007 3 2.25 3S21 13.657 21 12a9 9 0 1 0-2.636 6.364M16.5 12V8.25" />
                </>
              ) : l.icon === "linkedin" ? (
                <>
                  <path
                    fill="currentColor"
                    stroke="none"
                    transform="scale(0.2667)"
                    d="M 83.349 0 H 6.651 C 2.978 0 0 2.887 0 6.447 v 77.106 C 0 87.114 2.978 90 6.651 90 h 76.698 C 87.022 90 90 87.114 90 83.553 V 6.447 C 90 2.887 87.022 0 83.349 0 z M 27.282 75.339 H 13.688 v -40.64 h 13.594 V 75.339 z M 20.485 29.151 h -0.088 c -4.562 0 -7.512 -3.121 -7.512 -7.021 c 0 -3.988 3.04 -7.022 7.69 -7.022 c 4.651 0 7.513 3.034 7.601 7.022 C 28.176 26.03 25.225 29.151 20.485 29.151 z M 76.299 75.339 H 62.707 V 53.598 c 0 -5.463 -1.968 -9.19 -6.887 -9.19 c -3.756 0 -5.992 2.513 -6.975 4.94 c -0.359 0.868 -0.447 2.081 -0.447 3.296 v 22.695 H 34.804 c 0 0 0.178 -36.826 0 -40.64 h 13.594 v 5.756 c 1.806 -2.769 5.036 -6.709 12.251 -6.709 c 8.944 0 15.65 5.808 15.65 18.291 V 75.339 z"
                  />
                </>
              ) : (
                <>
                  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
                  <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                </>
              )}
            </svg>
          </a>
        ))}

        {TEXT_LINKS.map((l) => (
          <a
            key={l.url + l.label}
            className="icon-btn theme-btn tl-main clickable"
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ width: "auto", padding: "0 10px", fontSize: 12, textDecoration: "none", whiteSpace: "nowrap" }}
          >
            {l.label} ↗
          </a>
        ))}

        {RESUME_URL && (
          <a
            className="icon-btn theme-btn clickable"
            href={RESUME_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ width: "auto", padding: "0 10px", fontSize: 12, textDecoration: "none", whiteSpace: "nowrap" }}
          >
            {RESUME_LABEL} ↗
          </a>
        )}

        <button
          className="icon-btn theme-btn clickable"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label="Toggle light and dark mode"
        >
          {theme === "dark" ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          )}
        </button>
        </div>
      </div>

      {/* Brush size ring that follows the cursor (canvas tabs only) */}
      <div
        ref={ringRef}
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: 8,
          height: 8,
          border: "1.5px solid #48dbfb",
          borderRadius: "50%",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.25)",
          pointerEvents: "none",
          zIndex: 5,
          opacity: 0,
        }}
      />

      {/* Hidden color picker used by the "+" custom color slice */}
      <input
        ref={colorInputRef}
        type="color"
        value={cssColor(brush.color)}
        tabIndex={-1}
        onChange={(e) => {
          const v = e.target.value;
          setBrush((b) => ({ ...b, color: v, style: b.style === "eraser" ? "solid" : b.style }));
          setTool("draw");
        }}
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
        }}
      />

      {/* Angle gizmo for the straight-line brush (only visible while dragging a line) */}
      <svg
        ref={gizmoRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 4,
          display: "none",
          overflow: "visible",
          color: "var(--fg)",
        }}
      >
        <defs>
          <linearGradient id="gz-fade" data-gz="grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.9" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line data-gz="base" stroke="url(#gz-fade)" strokeWidth="1.25" />
        <path data-gz="arc" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <circle data-gz="dot" r="2.5" fill="currentColor" />
        <text
          data-gz="label"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="12"
          fill="currentColor"
          style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3, strokeLinejoin: "round", userSelect: "none" }}
        />
      </svg>

      {/* Pie menu. Desktop: two rings (the brush / color ring wraps around the main ring).
          Touch: one ring at a time, the centre is a back button, and a thin half-circle
          slider underneath sets the brush thickness. */}
      {menu && (
        <div
          ref={menuRef}
          onClickCapture={(e) => {
            if (openGestureRef.current) e.stopPropagation();
          }}
          style={{
            position: "fixed",
            left: menu.x - pieR,
            top: menu.y - pieR,
            width: pieR * 2,
            height: pieR * 2,
            zIndex: 10,
            pointerEvents: "none",
            animation: "pieIn 0.14s ease-out",
          }}
        >
          <svg
            width={pieR * 2}
            height={pieR * 2}
            viewBox={-pieR + " " + -pieR + " " + pieR * 2 + " " + pieR * 2}
            style={{ display: "block", overflow: "visible", pointerEvents: "none" }}
          >
            {menu.touch ? (
              <>
                {sub === null && <Ring slices={mainSlices} r0={TOUCH_RING.r0} r1={TOUCH_RING.r1} />}
                {sub === "brush" && <Ring slices={brushSlices} r0={TOUCH_RING.r0} r1={TOUCH_RING.r1} />}
                {sub === "color" && <Ring slices={colorSlices} r0={TOUCH_RING.r0} r1={TOUCH_RING.r1} />}

                {/* Center: back to the previous ring (or close, on the first ring) */}
                <g
                  className="clickable"
                  onClick={() => (sub ? setSub(null) : close())}
                  style={{ pointerEvents: "auto" }}
                >
                  <circle className="pie-center" r={TOUCH_CENTER_R} />
                  {sub ? (
                    <>
                      <text
                        y={-5}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={20}
                        className="pie-text"
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        ←
                      </text>
                      <text
                        y={13}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={10}
                        className="pie-text"
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        Back
                      </text>
                    </>
                  ) : (
                    centerPreview
                  )}
                </g>

                {/* Thickness slider: thin half circle under the menu, thin on the left, thick on the right */}
                <g>
                  <path
                    d={"M " + -TOUCH_SLIDER_R + " 0 A " + TOUCH_SLIDER_R + " " + TOUCH_SLIDER_R + " 0 0 0 " + TOUCH_SLIDER_R + " 0"}
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth={3}
                    strokeLinecap="round"
                    style={{ pointerEvents: "none" }}
                  />
                  {brush.size > 1 && (
                    <path
                      d={"M " + -TOUCH_SLIDER_R + " 0 A " + TOUCH_SLIDER_R + " " + TOUCH_SLIDER_R + " 0 0 0 " + thumbX + " " + thumbY}
                      fill="none"
                      stroke="var(--fg)"
                      strokeWidth={3}
                      strokeLinecap="round"
                      style={{ pointerEvents: "none" }}
                    />
                  )}
                  <circle
                    cx={thumbX}
                    cy={thumbY}
                    r={9}
                    fill="var(--fg)"
                    stroke="var(--bg)"
                    strokeWidth={2}
                    style={{ pointerEvents: "none" }}
                  />
                  <text
                    y={TOUCH_SLIDER_R + 22}
                    textAnchor="middle"
                    fontSize={12}
                    className="pie-text"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {brush.size} px
                  </text>
                  {/* Wide invisible target so a thumb can grab the slider easily */}
                  <path
                    d={"M " + -TOUCH_SLIDER_R + " 0 A " + TOUCH_SLIDER_R + " " + TOUCH_SLIDER_R + " 0 0 0 " + TOUCH_SLIDER_R + " 0"}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={38}
                    strokeLinecap="round"
                    role="slider"
                    aria-label="Brush thickness"
                    aria-valuemin={1}
                    aria-valuemax={80}
                    aria-valuenow={brush.size}
                    style={{ pointerEvents: "stroke" }}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setSizeFromPointer(e);
                    }}
                    onPointerMove={(e) => {
                      if (e.buttons) setSizeFromPointer(e);
                    }}
                  />
                </g>
              </>
            ) : (
              <>
                {sub === "brush" && <Ring slices={brushSlices} r0={RING2.r0} r1={RING2.r1} />}
                {sub === "color" && <Ring slices={colorSlices} r0={RING2.r0} r1={RING2.r1} />}
                <Ring slices={mainSlices} r0={RING1.r0} r1={RING1.r1} />

                {/* Center: shows current brush, click to close */}
                <g className="clickable" onClick={close} style={{ pointerEvents: "auto" }}>
                  <circle className="pie-center" r={30} />
                  {centerPreview}
                </g>
              </>
            )}
          </svg>
        </div>
      )}
    </main>
  );
}
