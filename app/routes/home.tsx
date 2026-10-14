import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

const LINES = [
  { text: "Hello.", size: "clamp(3.5rem, 12vw, 8rem)", weight: 700 },
  { text: "Welcome to my free style canvas", size: "clamp(1.2rem, 3.5vw, 2.2rem)", weight: 300 },
];

// ---- Text physics (tweak the feel here) ----
const RADIUS = 140;
const PUSH = 1.4;
const SPRING = 0.07;
const DAMPING = 0.84;
const MAX_OFFSET = 28;

// ---- Brush options ----
const STYLES = [
  { id: "solid", label: "Solid" },
  { id: "dotted", label: "Dotted" },
  { id: "dashed", label: "Dashed" },
  { id: "double", label: "Double line" },
  { id: "spray", label: "Spray" },
  { id: "neon", label: "Neon glow" },
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

type Particle = {
  el: HTMLElement;
  restX: number;
  restY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export default function Home() {
  const textRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const clearRef = useRef<() => void>(() => {});

  const [brush, setBrush] = useState<Brush>({ color: "#48dbfb", style: "solid", size: 8 });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

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

  // ---------- Drawing ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    // Size the canvas, keeping the existing drawing on resize
    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const oldW = canvas.width / dpr;
      const oldH = canvas.height / dpr;

      let snapshot: HTMLCanvasElement | null = null;
      if (canvas.width > 0 && canvas.height > 0) {
        snapshot = document.createElement("canvas");
        snapshot.width = canvas.width;
        snapshot.height = canvas.height;
        snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
      }

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (snapshot) ctx.drawImage(snapshot, 0, 0, oldW, oldH);
    };
    resize();
    window.addEventListener("resize", resize);

    let drawing = false;
    let last = { x: 0, y: 0 };
    let carry = 0; // distance since last dot (dotted)
    let pathDist = 0; // total distance along stroke (dashed)

    const prep = () => {
      const b = brushRef.current;
      ctx.globalCompositeOperation = b.style === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = b.color;
      ctx.fillStyle = b.color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowBlur = 0;
      return b;
    };

    const dot = (x: number, y: number, r: number) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };

    const spray = (x: number, y: number, size: number) => {
      const n = 6 + size;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * size * 1.5;
        ctx.fillRect(x + Math.cos(a) * r, y + Math.sin(a) * r, 1.3, 1.3);
      }
    };

    const stamp = (x: number, y: number) => {
      const b = prep();
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

    const segment = (x: number, y: number) => {
      const b = prep();
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
      return true;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.ctrlKey || menuOpenRef.current) return;
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
      carry = 0;
      pathDist = 0;
      stamp(e.clientX, e.clientY);
    };

    const onMove = (e: PointerEvent) => {
      const ring = ringRef.current;
      if (ring) {
        ring.style.transform =
          "translate(" + e.clientX + "px, " + e.clientY + "px) translate(-50%, -50%)";
        ring.style.opacity = menuOpenRef.current ? "0" : "1";
      }
      if (!drawing) return;
      if (segment(e.clientX, e.clientY)) last = { x: e.clientX, y: e.clientY };
    };

    const onUp = () => {
      drawing = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = Math.min(3, Math.max(1, Math.round(Math.abs(e.deltaY) / 50)));
      const dir = e.deltaY < 0 ? 1 : -1;
      setBrush((b) => ({ ...b, size: Math.min(80, Math.max(1, b.size + dir * step)) }));
    };

    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      drawing = false;
      setMenu({ x: e.clientX, y: e.clientY });
    };

    const onGlobalDown = (e: PointerEvent) => {
      const m = menuRef.current;
      if (m && !m.contains(e.target as Node)) setMenu(null);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };

    clearRef.current = () => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
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

  const clearCanvas = () => {
    clearRef.current();
    setMenu(null);
  };

  const menuLeft = menu ? Math.min(menu.x, window.innerWidth - 230) : 0;
  const menuTop = menu ? Math.min(menu.y, window.innerHeight - 400) : 0;

  const label: CSSProperties = {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    opacity: 0.55,
    margin: "10px 0 6px",
  };

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
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 0 }} />

      {/* Text layer (doesn't block drawing) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          pointerEvents: "none",
          zIndex: 1,
        }}
      >
        <div
          ref={textRef}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1.2rem",
            padding: "2rem",
            textAlign: "center",
            userSelect: "none",
          }}
        >
          {LINES.map((line, li) => (
            <div
              key={li}
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                columnGap: "0.35em",
                fontSize: line.size,
                fontWeight: line.weight,
                lineHeight: 1.15,
              }}
            >
              {line.text.split(" ").map((word, wi) => (
                <span key={wi} style={{ display: "inline-flex", whiteSpace: "nowrap" }}>
                  {word.split("").map((ch, ci) => (
                    <span
                      key={ci}
                      data-char
                      style={{ display: "inline-block", willChange: "transform" }}
                    >
                      {ch}
                    </span>
                  ))}
                </span>
              ))}
            </div>
          ))}
        </div>
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
        Left click: draw · Right click: brush menu · Scroll: thickness ({brush.size}px)
      </div>

      {/* Right-click menu */}
      {menu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: menuLeft,
            top: menuTop,
            width: 210,
            padding: 12,
            background: "rgba(24,24,30,0.96)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            zIndex: 10,
            fontSize: 14,
            backdropFilter: "blur(10px)",
          }}
        >
          <div style={{ ...label, marginTop: 0 }}>Color</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() =>
                  setBrush((b) => ({
                    ...b,
                    color: c,
                    style: b.style === "eraser" ? "solid" : b.style,
                  }))
                }
                aria-label={c}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: c,
                  border: brush.color === c ? "2px solid #fff" : "2px solid transparent",
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            ))}
            <input
              type="color"
              value={brush.color}
              onChange={(e) => setBrush((b) => ({ ...b, color: e.target.value }))}
              style={{
                width: 26,
                height: 26,
                padding: 0,
                border: "none",
                background: "none",
                cursor: "pointer",
              }}
            />
          </div>

          <div style={label}>Brush style</div>
          <div style={{ display: "grid", gap: 2 }}>
            {STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => setBrush((b) => ({ ...b, style: s.id }))}
                style={{
                  textAlign: "left",
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  color: "inherit",
                  font: "inherit",
                  background: brush.style === s.id ? "rgba(255,255,255,0.14)" : "transparent",
                }}
              >
                {brush.style === s.id ? "● " : "○ "}
                {s.label}
              </button>
            ))}
          </div>

          <div style={label}>Thickness: {brush.size}px</div>
          <input
            type="range"
            min={1}
            max={80}
            value={brush.size}
            onChange={(e) => setBrush((b) => ({ ...b, size: Number(e.target.value) }))}
            style={{ width: "100%" }}
          />

          <button
            onClick={clearCanvas}
            style={{
              marginTop: 10,
              width: "100%",
              padding: "7px 0",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "transparent",
              color: "#ff7b7b",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Clear canvas
          </button>
        </div>
      )}
    </main>
  );
}