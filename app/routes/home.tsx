import { useEffect, useRef, useState } from "react";

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

const COLORS = [
  "#f5f5f7",
  "#ff5a5f",
  "#ff9f43",
  "#feca57",
  "#1dd1a1",
  "#48dbfb",
  "#5f7cff",
  "#b46bff",
  "#ff6bd6",
];

type Brush = { color: string; style: StyleId; size: number };
type Pt = { x: number; y: number };
type StrokeOp = { kind: "stroke"; brush: Brush; seed: number; pts: Pt[] };
type Op = StrokeOp | { kind: "clear" };
type TabData = { ops: Op[]; cursor: number };
type Tab = { id: number; name: string };

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
            onClick={s.onSelect}
            style={{
              cursor: "pointer",
              opacity: s.disabled ? 0.35 : 1,
              pointerEvents: s.disabled ? "none" : "auto",
            }}
          >
            <path
              className={s.fill ? "pie-color" : "pie-dark"}
              d={wedge(r0, r1, a0, a1)}
              fill={s.fill ?? "rgba(28,28,36,0.95)"}
              stroke={s.active ? "#ffffff" : "rgba(255,255,255,0.16)"}
              strokeWidth={s.active ? 2.5 : 1}
            />
            {hasIcon && (
              <text
                x={tx}
                y={ty - (hasLabel ? 8 : 0)}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={18}
                fill={s.iconColor ?? "#f5f5f7"}
                style={{ pointerEvents: "none", userSelect: "none" }}
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
                fill="#f5f5f7"
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
function createPainter(ctx: CanvasRenderingContext2D) {
  let b: Brush = { color: "#ffffff", style: "solid", size: 8 };
  let last: Pt = { x: 0, y: 0 };
  let carry = 0; // distance since last dot (dotted)
  let pathDist = 0; // distance along the stroke (dashed)
  let rnd: () => number = Math.random;

  const prep = () => {
    ctx.globalCompositeOperation = b.style === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = b.color;
    ctx.fillStyle = b.color;
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
      ctx.shadowColor = b.color;
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
        ctx.shadowColor = b.color;
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

  // Tabs (session only: drawings live in memory and disappear on reload)
  const [tabs, setTabs] = useState<Tab[]>([{ id: 1, name: "Canvas 1" }]);
  const [activeId, setActiveId] = useState(1);
  const dataRef = useRef<Map<number, TabData>>(new Map([[1, { ops: [], cursor: 0 }]]));
  const activeRef = useRef(1);
  const nextIdRef = useRef(2);
  const counterRef = useRef(1);

  const [brush, setBrush] = useState<Brush>({ color: "#48dbfb", style: "solid", size: 8 });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [sub, setSub] = useState<"brush" | "color" | null>(null);
  const [hist, setHist] = useState({ undo: false, redo: false });

  const brushRef = useRef(brush);
  brushRef.current = brush;
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menu !== null;

  // Keep the cursor ring in sync with brush settings
  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;
    const d = Math.max(brush.size * (brush.style === "eraser" ? 1.5 : 1), 6);
    ring.style.width = d + "px";
    ring.style.height = d + "px";
    ring.style.borderColor = brush.style === "eraser" ? "#ffffff" : brush.color;
  }, [brush]);

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

  // ---------- Drawing, undo / redo, tabs ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const painter = createPainter(ctx);

    let current: StrokeOp | null = null;
    let drawing = false;

    // History of the active tab. Stored as strokes, so it survives window resizing.
    const cur = (): TabData => {
      let d = dataRef.current.get(activeRef.current);
      if (!d) {
        d = { ops: [], cursor: 0 };
        dataRef.current.set(activeRef.current, d);
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
      if (e.button !== 0 || e.ctrlKey || menuOpenRef.current) return;
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
        ring.style.opacity = menuOpenRef.current || overBar ? "0" : "1";
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
      e.preventDefault();
      if (tabBarRef.current && tabBarRef.current.contains(e.target as Node)) return;
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

  // ---------- Tab actions ----------
  const selectTab = (id: number) => {
    activeRef.current = id;
    setActiveId(id);
    setMenu(null);
    actionsRef.current.refresh();
  };

  const addTab = () => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    counterRef.current += 1;
    dataRef.current.set(id, { ops: [], cursor: 0 });
    setTabs((t) => [...t, { id, name: "Canvas " + counterRef.current }]);
    selectTab(id);
  };

  const closeTab = (id: number) => {
    if (tabs.length <= 1) return;
    const d = dataRef.current.get(id);
    if (d && d.cursor > 0 && !window.confirm("Close this canvas? Its drawing will be lost.")) {
      return;
    }
    const idx = tabs.findIndex((t) => t.id === id);
    const rest = tabs.filter((t) => t.id !== id);
    dataRef.current.delete(id);
    setTabs(rest);
    if (id === activeId) selectTab(rest[Math.min(idx, rest.length - 1)].id);
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
      iconColor: brush.color,
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
      fill: c,
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

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        background: "#0b0b0f",
        color: "#f5f5f7",
        overflow: "hidden",
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        touchAction: "none",
        cursor: menu ? "default" : "none",
      }}
    >
      <style>{`
        @keyframes pieIn {
          from { opacity: 0; transform: scale(0.7); }
          to { opacity: 1; transform: scale(1); }
        }
        .pie-dark { transition: fill 0.12s; }
        .pie-dark:hover { fill: rgba(78, 78, 104, 0.98); }
        .pie-color { transition: filter 0.12s; }
        .pie-color:hover { filter: brightness(1.3); }
        .tab-item:hover { background: rgba(255,255,255,0.07) !important; }
        .tab-x:hover { opacity: 1 !important; background: rgba(255,255,255,0.15); }
        .tab-bar::-webkit-scrollbar { display: none; }
      `}</style>

      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 0 }} />

      {/* "Hello." in the top-left corner (doesn't block drawing) */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: TAB_BAR_H,
          padding: "20px 36px",
          pointerEvents: "none",
          zIndex: 1,
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

      {/* Tab bar */}
      <div
        ref={tabBarRef}
        className="tab-bar"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: TAB_BAR_H,
          display: "flex",
          alignItems: "flex-end",
          gap: 3,
          padding: "0 10px",
          background: "rgba(16,16,22,0.96)",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          zIndex: 6,
          cursor: "default",
          overflowX: "auto",
          userSelect: "none",
        }}
      >
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <div
              key={t.id}
              className="tab-item"
              onClick={() => selectTab(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 30,
                padding: "0 10px 0 14px",
                borderRadius: "8px 8px 0 0",
                fontSize: 13,
                whiteSpace: "nowrap",
                cursor: "pointer",
                background: active ? "#0b0b0f" : "transparent",
                color: active ? "#f5f5f7" : "rgba(245,245,247,0.6)",
                border: active
                  ? "1px solid rgba(255,255,255,0.14)"
                  : "1px solid transparent",
                borderBottom: "none",
              }}
            >
              {t.name}
              {tabs.length > 1 && (
                <span
                  className="tab-x"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.id);
                  }}
                  title="Close canvas"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    lineHeight: 1,
                    opacity: 0.5,
                  }}
                >
                  ×
                </span>
              )}
            </div>
          );
        })}
        <button
          onClick={addTab}
          title="New canvas"
          style={{
            alignSelf: "center",
            width: 26,
            height: 26,
            marginLeft: 4,
            borderRadius: 6,
            border: "none",
            background: "rgba(255,255,255,0.08)",
            color: "#f5f5f7",
            fontSize: 16,
            lineHeight: 1,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          +
        </button>
      </div>

      {/* Brush size ring that follows the cursor */}
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
          pointerEvents: "none",
          zIndex: 5,
          opacity: 0,
          mixBlendMode: "difference",
        }}
      />

      <div
        style={{
          position: "fixed",
          bottom: 14,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 12,
          opacity: 0.4,
          pointerEvents: "none",
          zIndex: 2,
        }}
      >
        Left click: draw · Right click: menu · Scroll or [ ]: thickness ({brush.size}px) · Ctrl/⌘+Z
        undo · Ctrl/⌘+Shift+Z redo
      </div>

      {/* Hidden color picker used by the "+" custom color slice */}
      <input
        ref={colorInputRef}
        type="color"
        value={brush.color}
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
            <g onClick={close} style={{ cursor: "pointer", pointerEvents: "auto" }}>
              <circle
                r={30}
                fill="rgba(28,28,36,0.95)"
                stroke="rgba(255,255,255,0.2)"
                strokeWidth={1}
              />
              {brush.style === "eraser" ? (
                <circle
                  r={previewR}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                  style={{ pointerEvents: "none" }}
                />
              ) : (
                <circle r={previewR} fill={brush.color} style={{ pointerEvents: "none" }} />
              )}
            </g>
          </svg>
        </div>
      )}
    </main>
  );
}
