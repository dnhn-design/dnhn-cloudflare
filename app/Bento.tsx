import { useEffect, useState } from "react";
import type { BentoTab } from "./portfolio";

// Renders one portfolio tab as a bento grid. Content lives in portfolio.ts.
export default function Bento({ tab }: { tab: BentoTab }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  // Close the PDF dialog when clicking elsewhere or pressing Esc
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest("[data-open-tile]")) setOpenIdx(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIdx(null);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <>
      <style>{`
        .bento {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          grid-auto-rows: 170px;
          grid-auto-flow: dense;
          gap: 14px;
          max-width: 1240px;
          margin: 0 auto;
        }
        @media (max-width: 800px) {
          .bento { grid-template-columns: repeat(2, 1fr); grid-auto-rows: 140px; }
          .bento-tile { grid-column: auto !important; }
        }
        .bento-tile {
          position: relative;
          border-radius: 18px;
          overflow: hidden;
          background: var(--ph);
          border: 1px solid var(--border);
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .bento-tile.has-link:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
        }
        .bento-tile img { width: 100%; height: 100%; display: block; }
        .bento-ph {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
          user-select: none;
        }
        .bento-badge {
          position: absolute;
          top: 10px;
          right: 10px;
          padding: 3px 8px;
          border-radius: 999px;
          font-size: 11px;
          background: var(--bar);
          border: 1px solid var(--border);
          opacity: 0;
          transition: opacity 0.15s;
          pointer-events: none;
        }
        .bento-tile.has-link:hover .bento-badge { opacity: 1; }
        .bento-text {
          background: var(--panel);
          padding: 20px 22px;
          overflow: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .bento-text h3 { margin: 0; font-size: 16px; font-weight: 650; }
        .bento-text p { margin: 0; font-size: 14px; line-height: 1.55; color: var(--muted); }
        .bento-pop {
          position: absolute;
          left: 10px;
          right: 10px;
          bottom: 10px;
          padding: 10px 12px;
          border-radius: 12px;
          background: var(--bar);
          border: 1px solid var(--border);
          backdrop-filter: blur(10px);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
          display: flex;
          flex-direction: column;
          gap: 8px;
          animation: popIn 0.14s ease-out;
        }
        .bento-pop-title { font-size: 12px; color: var(--muted); }
        .bento-pop-link {
          display: block;
          text-align: center;
          padding: 7px 10px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          text-decoration: none;
          color: var(--fg);
          background: var(--panel);
          border: 1px solid var(--border);
        }
        .bento-pop-link:hover { background: var(--border); }
        @keyframes popIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="bento">
        {tab.items.map((item, i) => {
          const w = item.w ?? 1;
          const h = item.h ?? 1;
          const span = { gridColumn: "span " + w, gridRow: "span " + h };

          if (item.type === "text") {
            return (
              <div key={i} className="bento-tile bento-text" style={span}>
                {item.title && <h3>{item.title}</h3>}
                {item.body && <p>{item.body}</p>}
              </div>
            );
          }

          const hasPdf = !!item.pdf;
          const isOpen = openIdx === i;
          const toggle = () => setOpenIdx(isOpen ? null : i);

          return (
            <div
              key={i}
              className={"bento-tile" + (hasPdf ? " has-link clickable" : "")}
              style={span}
              data-open-tile={isOpen ? "" : undefined}
              onClick={hasPdf ? toggle : undefined}
              role={hasPdf ? "button" : undefined}
              tabIndex={hasPdf ? 0 : undefined}
              onKeyDown={
                hasPdf
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle();
                      }
                    }
                  : undefined
              }
            >
              {item.src ? (
                <img
                  src={item.src}
                  alt={item.alt ?? item.label ?? ""}
                  draggable={false}
                  style={{ objectFit: item.fit ?? "cover" }}
                />
              ) : (
                <div className="bento-ph">
                  <span>{item.label ?? "Image"}</span>
                </div>
              )}

              {hasPdf && !isOpen && <div className="bento-badge">PDF ↗</div>}

              {hasPdf && isOpen && (
                <div className="bento-pop" onClick={(e) => e.stopPropagation()}>
                  <div className="bento-pop-title">{item.label ?? item.alt ?? "Project"}</div>
                  <a
                    className="bento-pop-link clickable"
                    href={item.pdf}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {(item.pdfLabel ?? "Open PDF") + " ↗"}
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
