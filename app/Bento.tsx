import { useEffect, useState } from "react";
import type { BentoItem, BentoProject, BentoTab } from "./portfolio";

// ---- Knobs --------------------------------------------------------------
const PROJECT_GAP = 72; // px of space between one project and the next
const HEADER_GAP = 20; // px between a project's title line and its grid
const COLLAPSE_MS = 280; // how long opening / closing takes
const TABLET_MAX = 1024; // screens this wide (px) or narrower never crop pictures: 2 columns, height follows the picture
// Desktop only: how a picture sits in its tile. "cover" fills the tile and trims the edges. "contain" shows the whole
// picture with empty space around it. A single tile can override this with fit: "cover" | "contain" in portfolio.ts.
const DESKTOP_FIT: "cover" | "contain" = "cover";
const TABLET_FILL_GAPS = false; // false = tiles keep the order of the file (may leave an empty half row). true = a later half-width tile can move up to fill the gap
const PHONE_MAX = 600; // screens this wide (px) or narrower get a single column
// -------------------------------------------------------------------------

// One bento grid (the tiles of a single project)
function BentoGrid({ items }: { items: BentoItem[] }) {
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
    <div className="bento">
      {items.map((item, i) => {
        const w = item.w ?? 1;
        const h = item.h ?? 1;
        const span = {
          gridColumn: "span " + w,
          gridRow: "span " + h,
          // shape of an empty placeholder on phones, taken from its desktop proportions
          ["--ph-aspect" as string]: String((299.5 * w + 14 * (w - 1)) / (170 * h + 14 * (h - 1))),
        };

        if (item.type === "text") {
          return (
            <div key={i} className={"bento-tile bento-text" + (w >= 2 ? " bento-wide" : "")} style={span}>
              {item.title && <h3>{item.title}</h3>}
              {item.body && <p>{item.body}</p>}
            </div>
          );
        }

        const hasPdf = !!item.pdf;
        // `pdf` can be a PDF file or any web link (Figma, Behance, a live site...). Wording follows what it is.
        const isPdfFile = !!item.pdf && /\.pdf($|[?#])/i.test(item.pdf);
        const isOpen = openIdx === i;
        const toggle = () => setOpenIdx(isOpen ? null : i);

        return (
          <div
            key={i}
            className={"bento-tile" + (w >= 2 ? " bento-wide" : "") + (hasPdf ? " has-link clickable" : "")}
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
              <img src={item.src} alt={item.alt ?? item.label ?? ""} draggable={false} style={{ objectFit: item.fit ?? DESKTOP_FIT, objectPosition: item.position ?? "center" }} />
            ) : (
              <div className="bento-ph">
                <span>{item.label ?? "Image"}</span>
              </div>
            )}

            {hasPdf && !isOpen && <div className="bento-badge">{isPdfFile ? "PDF" : "Link"} ↗</div>}

            {hasPdf && isOpen && (
              <div className="bento-pop" onClick={(e) => e.stopPropagation()}>
                <div className="bento-pop-title">{item.label ?? item.alt ?? "Project"}</div>
                <a className="bento-pop-link clickable" href={item.pdf} target="_blank" rel="noopener noreferrer">
                  {(item.pdfLabel ?? (isPdfFile ? "Open PDF" : "Open link")) + " ↗"}
                </a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// One project: a title line with a chevron, and the grid underneath that folds away
function Project({ project, tabId, index, showHeader }: { project: BentoProject; tabId: string; index: number; showHeader: boolean }) {
  const [open, setOpen] = useState(!project.collapsed);
  const bodyId = "bento-" + tabId + "-" + index;

  // A project without a title is just a plain grid (nothing to fold)
  if (!showHeader)
    return (
      <section className="bento-project">
        <BentoGrid items={project.items} />
      </section>
    );

  return (
    <section className={"bento-project" + (open ? "" : " is-collapsed")}>
      <button type="button" className="bento-head clickable" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId}>
        <span className="bento-head-title">{project.title}</span>
        <span className="bento-head-rule" aria-hidden="true" />
        <svg className="bento-chevron" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M4 7l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id={bodyId} className="bento-body">
        <div className="bento-body-inner">
          <BentoGrid items={project.items} />
        </div>
      </div>
    </section>
  );
}

// Renders one portfolio tab. Content lives in portfolio.ts.
export default function Bento({ tab }: { tab: BentoTab }) {
  // `projects` is the new form; a plain `items` list still works (one project, no title line)
  const projects: BentoProject[] = (tab.projects ?? (tab.items ? [{ items: tab.items }] : [])).filter((p) => p.items.length > 0);

  return (
    <>
      <style>{`
        .bento-wrap { max-width: 1240px; margin: 0 auto; container-type: inline-size; }
        .bento {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          grid-auto-rows: 170px; /* fallback for very old browsers */
          /* Row height scales with the column width, so every tile keeps the same shape as the window
             gets narrower (no squashing). At the full 1240px width a row is 170px, as before. */
          --gap: 14px;
          --col: calc((100cqw - 3 * var(--gap)) / 4);
          grid-auto-rows: calc(var(--col) * 0.5676);
          grid-auto-flow: dense;
          gap: var(--gap);
          max-width: 1240px;
          margin: 0 auto;
        }
        /* Tablets and phones (${TABLET_MAX}px and narrower): nothing is ever cropped. A tile is half the width
           (w: 1) or the full width (w: 2 or more), and its height follows the picture's own shape.
           Tiles stay in the order of the file. On desktop the w / h shapes you set in portfolio.ts are used as they are. */
        @media (max-width: ${TABLET_MAX}px) {
          .bento { grid-template-columns: repeat(2, 1fr); grid-auto-rows: auto; grid-auto-flow: ${TABLET_FILL_GAPS ? "dense" : "row"}; align-items: start; }
          .bento-tile { grid-column: auto !important; grid-row: auto !important; }
          .bento-tile.bento-wide { grid-column: 1 / -1 !important; }
          .bento-tile img { height: auto; }
          .bento-ph { height: auto; aspect-ratio: var(--ph-aspect, 16 / 9); }
          .bento-text { overflow: visible; }
        }
        /* Phones only (${PHONE_MAX}px and narrower): a single column */
        @media (max-width: ${PHONE_MAX}px) {
          .bento { grid-template-columns: 1fr; }
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

        /* Collapsible projects */
        .bento-project + .bento-project { margin-top: ${PROJECT_GAP}px; }
        .bento-head {
          display: flex;
          align-items: center;
          gap: 18px;
          width: 100%;
          margin: 0 0 ${HEADER_GAP}px;
          padding: 6px 0;
          background: none;
          border: 0;
          color: var(--fg);
          font: inherit;
          text-align: left;
        }
        .bento-head-title { font-size: 17px; font-weight: 650; letter-spacing: -0.005em; }
        .bento-head-rule { flex: 1; height: 1px; background: var(--border); }
        .bento-chevron { flex: none; color: var(--muted); transform: rotate(180deg); transition: transform ${COLLAPSE_MS}ms ease, color 0.15s; }
        .bento-head:hover .bento-chevron { color: var(--fg); }
        .bento-head:focus-visible { outline: 2px solid var(--fg); outline-offset: 4px; border-radius: 4px; }
        .is-collapsed .bento-chevron { transform: rotate(0deg); }
        .is-collapsed .bento-head { margin-bottom: 0; }

        /* The grid folds away smoothly. Padding / negative margin keep hover shadows from being cut off. */
        .bento-body { display: grid; grid-template-rows: 1fr; transition: grid-template-rows ${COLLAPSE_MS}ms ease; }
        .bento-body-inner { min-height: 0; overflow: hidden; padding: 8px 28px 44px; margin: -8px -28px -44px; }
        .is-collapsed .bento-body { grid-template-rows: 0fr; visibility: hidden; transition: grid-template-rows ${COLLAPSE_MS}ms ease, visibility 0s ${COLLAPSE_MS}ms; }
        @media (prefers-reduced-motion: reduce) {
          .bento-body, .is-collapsed .bento-body, .bento-chevron { transition: none; }
        }
      `}</style>

      <div className="bento-wrap">
        {projects.map((p, i) => (
          <Project key={i} project={p} tabId={tab.id} index={i} showHeader={!!p.title} />
        ))}
      </div>
    </>
  );
}
