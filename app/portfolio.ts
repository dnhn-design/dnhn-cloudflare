// =====================================================================
//  PORTFOLIO CONTENT  —  this is the only file you need to edit.
//
//  Each entry in PORTFOLIO becomes one (uncloseable) tab, in this order,
//  right after the first "Canvas" tab.
//
//  - Add a tab:     copy a whole { id, title, items } block.
//  - Rename a tab:  change `title`.
//  - Remove a tab:  delete its block.
//
//  Each tab has `items`: the tiles of the bento grid. The grid is 4 columns
//  wide (2 on phones). Tiles flow left-to-right and fill gaps automatically.
//
//  TILE OPTIONS (all optional):
//    w, h       size in grid cells, e.g. { w: 2, h: 2 } = big square. Default 1 x 1.
//
//    IMAGE TILE (default)
//    src        path to an image in the /public folder, e.g. "/images/logo.jpg"
//               (leave it out to show a grey placeholder box)
//    alt        accessibility description
//    label      text shown on the grey placeholder, and the title in the PDF dialog
//    fit        "cover" (fills the tile, default) or "contain" (shows the whole image)
//    pdf        path to a PDF in /public, e.g. "/pdfs/case-study.pdf"
//               -> adding this makes the tile clickable; clicking opens a small
//                  dialog with a link to the PDF. No `pdf` = tile is not clickable.
//    pdfLabel   text on that link (default "Open PDF")
//
//    TEXT TILE
//    type       "text"
//    title      small heading (optional)
//    body       the paragraph (keep it concise, ~40 words fits a 2x1 tile)
//
//  WHERE FILES GO (Vite serves everything in /public from the site root):
//    public/images/   your images      ->  src: "/images/photo.jpg"
//    public/pdfs/     your PDFs        ->  pdf: "/pdfs/project.pdf"
//  Tip: keep images under ~1 MB (resize/compress before adding). If you ever
//  have lots of big files, host them on Cloudflare R2 and use the full https URL
//  in `src` / `pdf` instead.
// =====================================================================

export type BentoItem = {
  type?: "image" | "text";
  w?: number;
  h?: number;

  // image tiles
  src?: string;
  alt?: string;
  label?: string;
  fit?: "cover" | "contain";
  pdf?: string;
  pdfLabel?: string;

  // text tiles
  title?: string;
  body?: string;
};

export type PortfolioTab = {
  id: string; // unique, no spaces
  title: string; // shown on the tab
  items: BentoItem[];
};

export const PORTFOLIO: PortfolioTab[] = [
  {
    id: "branding",
    title: "Branding",
    items: [
      { w: 2, h: 2, label: "Hero project", pdf: "/pdfs/example.pdf", pdfLabel: "View case study" },
      {
        type: "text",
        w: 2,
        title: "About this collection",
        body: "A short paragraph about this group of projects: the clients, the problem you solved, and the thinking behind the work. Replace this with your own words.",
      },
      { label: "Logo" },
      { label: "Packaging", pdf: "/pdfs/example.pdf" },
      { h: 2, label: "Poster" },
      { w: 2, label: "Wide banner" },
      { label: "Detail" },
      { label: "Mockup" },
    ],
  },
  {
    id: "web",
    title: "Web",
    items: [
      { w: 2, label: "Landing page", pdf: "/pdfs/example.pdf" },
      { label: "Mobile" },
      { label: "Component" },
      { type: "text", h: 2, title: "Process", body: "Briefly describe how you approach web projects: research, wireframes, build, launch." },
      { w: 2, h: 2, label: "Dashboard" },
      { label: "Icon set" },
      { label: "Prototype", pdf: "/pdfs/example.pdf" },
    ],
  },
  {
    id: "print",
    title: "Print",
    items: [
      { h: 2, label: "Editorial" },
      { w: 2, h: 2, label: "Book cover", pdf: "/pdfs/example.pdf", pdfLabel: "Open full PDF" },
      { label: "Spread" },
      { label: "Flyer" },
      { type: "text", w: 2, title: "Notes", body: "Print work, from editorial layouts to posters. Add a line about materials, formats or collaborators." },
      { label: "Poster" },
      { label: "Card" },
    ],
  },
];
