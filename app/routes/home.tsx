import { useEffect, useRef, useState } from "react";
import Bento from "../Bento";
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
  { id: "dotted", label: "Dotted" },
  { id: "dashed", label: "Dashed" },
  { id: "double", label: "Double" },
  { id: "spray", label: "Spray" },
  { id: "neon", label: "Neon" },
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
type StrokeOp = { kind: "stroke"; brush: Brush; seed: number; pts: Pt[] };
type Op = StrokeOp | { kind: "clear" };
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

// ---- Pie menu geometry ----
const PIE_R = 160; // outer radius of the whole menu (px)
const RING1 = { r0: 36, r1: 92 };
const RING2 = { r0: 98, r1: 152 };

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

// Small seeded random so spray strokes look identical when redrawn (undo/redo, tab switch)
function mulberry32(seed: number) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Draws strokes onto a canvas context. Used for live drawing and for replaying history.
function createPainter(ctx: CanvasRenderingContext2D, getInk: () => string) {
  let b: Brush = { color: "#ffffff", style: "solid", size: 8 };
  let last: Pt = { x: 0, y: 0 };
  let carry = 0; // distance since last dot (dotted)
  let pathDist = 0; // distance along the stroke (dashed)
  let rnd: () => number = Math.random;

  const col = () => (b.color === "ink" ? getInk() : b.color);

  const prep = () => {
    ctx.globalCompositeOperation = b.style === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = col();
    ctx.fillStyle = col();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = 0;
  };

  const dot = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  const spray = (x: number, y: number, size: number) => {
    const n = 6 + size;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * size * 1.5;
      ctx.fillRect(x + Math.cos(a) * r, y + Math.sin(a) * r, 1.3, 1.3);
    }
  };

  const stamp = (x: number, y: number) => {
    prep();
    if (b.style === "spray") {
      spray(x, y, b.size);
      return;
    }
    if (b.style === "neon") {
      ctx.shadowColor = col();
      ctx.shadowBlur = b.size * 2;
      dot(x, y, b.size / 2);
      ctx.shadowBlur = 0;
      return;
    }
    const r = (b.style === "eraser" ? b.size * 1.5 : b.size) / 2;
    dot(x, y, r);
  };

  const begin = (brush: Brush, p: Pt, seed: number) => {
    b = brush;
    last = { x: p.x, y: p.y };
    carry = 0;
    pathDist = 0;
    rnd = mulberry32(seed);
    stamp(p.x, p.y);
  };

  // Returns true if a segment was drawn
  const segment = (p: Pt): boolean => {
    prep();
    const x = p.x;
    const y = p.y;
    const dx = x - last.x;
    const dy = y - last.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return false;

    switch (b.style) {
      case "solid":
      case "eraser": {
        ctx.lineWidth = b.style === "eraser" ? b.size * 1.5 : b.size;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        break;
      }

      case "dotted": {
        const spacing = Math.max(b.size * 2, 4);
        let d = spacing - carry;
        while (d <= len) {
          dot(last.x + (dx / len) * d, last.y + (dy / len) * d, b.size / 2);
          d += spacing;
        }
        carry = len - (d - spacing);
        break;
      }

      case "dashed": {
        const period = b.size * 3.5;
        const on = b.size * 1.5;
        ctx.lineCap = "butt";
        ctx.lineWidth = b.size;
        let d = 0;
        while (d < len) {
          const phase = (pathDist + d) % period;
          const inDash = phase < on;
          const step = Math.min((inDash ? on : period) - phase, len - d);
          if (inDash) {
            ctx.beginPath();
            ctx.moveTo(last.x + (dx / len) * d, last.y + (dy / len) * d);
            ctx.lineTo(last.x + (dx / len) * (d + step), last.y + (dy / len) * (d + step));
            ctx.stroke();
          }
          d += Math.max(step, 0.01);
        }
        pathDist += len;
        break;
      }

      case "double": {
        const nx = -dy / len;
        const ny = dx / len;
        const off = b.size * 0.8;
        ctx.lineWidth = Math.max(1, b.size / 3);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(last.x + nx * off * s, last.y + ny * off * s);
          ctx.lineTo(x + nx * off * s, y + ny * off * s);
          ctx.stroke();
        }
        break;
      }

      case "spray": {
        const steps = Math.ceil(len / 4);
        for (let i = 1; i <= steps; i++) {
          spray(last.x + (dx * i) / steps, last.y + (dy * i) / steps, b.size);
        }
        break;
      }

      case "neon": {
        ctx.shadowColor = col();
        ctx.shadowBlur = b.size * 2;
        ctx.lineWidth = b.size;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = Math.max(1, b.size * 0.3);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        break;
      }
    }

    last = { x, y };
    return true;
  };

  return { begin, segment };
}

export default function Home() {
  const textRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const actionsRef = useRef({
    undo: () => {},
    redo: () => {},
    clear: () => {},
    refresh: () => {},
  });

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
  const onCanvasRef = useRef(true);
  onCanvasRef.current = onCanvas;

  const [brush, setBrush] = useState<Brush>({ color: "#48dbfb", style: "solid", size: 8 });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [sub, setSub] = useState<"brush" | "color" | null>(null);
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
  }, []);

  // ---------- Drawing, undo / redo ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const painter = createPainter(ctx, () => inkFor(themeRef.current));

    let current: StrokeOp | null = null;
    let drawing = false;

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

    const redraw = () => {
      wipe();
      const d = cur();
      let start = 0;
      for (let i = d.cursor - 1; i >= 0; i--) {
        if (d.ops[i].kind === "clear") {
          start = i + 1;
          break;
        }
      }
      for (let i = start; i < d.cursor; i++) {
        const op = d.ops[i];
        if (op.kind === "stroke") {
          painter.begin(op.brush, op.pts[0], op.seed);
          for (let j = 1; j < op.pts.length; j++) painter.segment(op.pts[j]);
        }
      }
    };

    const commit = (op: Op) => {
      const d = cur();
      d.ops.length = d.cursor; // drop any redo history
      d.ops.push(op);
      d.cursor = d.ops.length;
      sync();
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
        if (current || d.cursor === 0) return;
        d.cursor -= 1;
        redraw();
        sync();
      },
      redo: () => {
        const d = cur();
        if (current || d.cursor >= d.ops.length) return;
        d.cursor += 1;
        redraw();
        sync();
      },
      clear: () => {
        if (current) return;
        commit({ kind: "clear" });
        redraw();
      },
      refresh: () => {
        redraw();
        sync();
      },
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.ctrlKey || menuOpenRef.current || !onCanvasRef.current) return;
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      const p = { x: e.clientX, y: e.clientY };
      const seed = Math.floor(Math.random() * 2147483647);
      const b = { ...brushRef.current };
      painter.begin(b, p, seed);
      current = { kind: "stroke", brush: b, seed, pts: [p] };
    };

    const onMove = (e: PointerEvent) => {
      const ring = ringRef.current;
      if (ring) {
        ring.style.transform =
          "translate(" + e.clientX + "px, " + e.clientY + "px) translate(-50%, -50%)";
        const overBar = !!tabBarRef.current && tabBarRef.current.contains(e.target as Node);
        const hide = menuOpenRef.current || overBar || !onCanvasRef.current;
        ring.style.opacity = hide ? "0" : "1";
      }
      if (!drawing || !current) return;
      const p = { x: e.clientX, y: e.clientY };
      if (painter.segment(p)) current.pts.push(p);
    };

    const onUp = () => {
      drawing = false;
      if (current) {
        commit(current);
        current = null;
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
      if (tabBarRef.current && tabBarRef.current.contains(e.target as Node)) {
        e.preventDefault();
        return;
      }
      if (!onCanvasRef.current) return; // normal browser menu on portfolio tabs
      e.preventDefault();
      if (drawing) onUp();
      const mx = Math.min(Math.max(e.clientX, PIE_R), Math.max(window.innerWidth - PIE_R, PIE_R));
      const my = Math.min(Math.max(e.clientY, PIE_R), Math.max(window.innerHeight - PIE_R, PIE_R));
      setSub(null);
      setMenu({ x: mx, y: my });
    };

    const onGlobalDown = (e: PointerEvent) => {
      const m = menuRef.current;
      if (m && !m.contains(e.target as Node)) setMenu(null);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
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
      // [ and ] nudge thickness by exactly 1px
      if (e.key === "[") setBrush((b) => ({ ...b, size: Math.max(1, b.size - 1) }));
      if (e.key === "]") setBrush((b) => ({ ...b, size: Math.min(80, b.size + 1) }));
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("pointerdown", onGlobalDown);
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("pointerdown", onGlobalDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Repaint when the theme changes so "ink" strokes switch color
  useEffect(() => {
    actionsRef.current.refresh();
  }, [theme]);

  // ---------- Tab actions ----------
  const selectTab = (id: string) => {
    setActiveTab(id);
    setMenu(null);
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

        .tab-scroll { scrollbar-width: none; }
        .tab-scroll::-webkit-scrollbar { display: none; }
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
        }}
      />

      {/* "Hello." in the top-left corner (only visible on canvas tabs, doesn't block drawing) */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: TAB_BAR_H,
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
            display: "flex",
            fontSize: "clamp(2.5rem, 7vw, 5rem)",
            fontWeight: 700,
            lineHeight: 1.1,
            userSelect: "none",
          }}
        >
          {"Hello.".split("").map((ch, i) => (
            <span key={i} data-char style={{ display: "inline-block", willChange: "transform" }}>
              {ch}
            </span>
          ))}
        </div>
      </div>

      {/* Portfolio view */}
      {portfolioTab && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: TAB_BAR_H,
            bottom: 0,
            overflowY: "auto",
            padding: "28px 32px 64px",
            background: "var(--bg)",
            zIndex: 2,
            touchAction: "pan-y",
          }}
        >
          <Bento key={portfolioTab.id} tab={portfolioTab} />
        </div>
      )}

      {/* Tab bar */}
      <div
        ref={tabBarRef}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: TAB_BAR_H,
          display: "flex",
          alignItems: "flex-end",
          padding: "0 10px",
          background: "var(--bar)",
          borderBottom: "1px solid var(--border)",
          zIndex: 6,
          userSelect: "none",
        }}
      >
        <div
          className="tab-scroll"
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 3,
            flex: 1,
            minWidth: 0,
            height: "100%",
            overflowX: "auto",
          }}
        >
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

        <button
          className="icon-btn clickable"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label="Toggle light and dark mode"
          style={{ alignSelf: "center", marginLeft: 10 }}
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

      {/* Pie menu */}
      {menu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: menu.x - PIE_R,
            top: menu.y - PIE_R,
            width: PIE_R * 2,
            height: PIE_R * 2,
            zIndex: 10,
            pointerEvents: "none",
            animation: "pieIn 0.14s ease-out",
          }}
        >
          <svg
            width={PIE_R * 2}
            height={PIE_R * 2}
            viewBox={-PIE_R + " " + -PIE_R + " " + PIE_R * 2 + " " + PIE_R * 2}
            style={{ display: "block", overflow: "visible", pointerEvents: "none" }}
          >
            {sub === "brush" && <Ring slices={brushSlices} r0={RING2.r0} r1={RING2.r1} />}
            {sub === "color" && <Ring slices={colorSlices} r0={RING2.r0} r1={RING2.r1} />}
            <Ring slices={mainSlices} r0={RING1.r0} r1={RING1.r1} />

            {/* Center: shows current brush, click to close */}
            <g className="clickable" onClick={close} style={{ pointerEvents: "auto" }}>
              <circle className="pie-center" r={30} />
              {brush.style === "eraser" ? (
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
                <circle
                  r={previewR}
                  style={{ pointerEvents: "none", fill: cssColor(brush.color) }}
                />
              )}
            </g>
          </svg>
        </div>
      )}
    </main>
  );
}
