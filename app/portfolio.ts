// =====================================================================
//  PORTFOLIO CONTENT  —  this is the only file you need to edit.
//
//  Each entry in PORTFOLIO becomes one (uncloseable) tab, in this order,
//  right after the first "Canvas" tab.
//
//  - Add a tab:     copy a whole { id, title, items } block.
//  - Rename a tab:  change `title`.
//  - Remove a tab:  delete its block.
//  - Zoomable PDF maps: see the "MAPS TAB" block at the bottom of this file.
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

// One tile of a MAPS tab: a PDF (or image) the visitor can zoom and pan.
export type MapItem = {
  src?: string; // "/maps/seoul.pdf" (PDF, vector, sharpest) or "/maps/seoul.png" / ".svg" / ".webp"
  title?: string; // small label in the corner of the tile
  alt?: string; // description for screen readers
  page?: number; // which PDF page to show (default 1)
  aspect?: string; // tile shape, e.g. "4 / 3" or "2 / 1". Overrides the tab's `aspect`
  bg?: string; // background behind the map, e.g. "#ffffff" (default) or "#101418"
  maxZoom?: number; // how far visitors can zoom in (default 12)
};

// A normal bento tab (images, text, PDF links)
export type BentoTab = {
  id: string; // unique, no spaces
  title: string; // shown on the tab
  kind?: "bento";
  items: BentoItem[];
};

// A maps tab (zoomable / pannable PDFs). Rendered by Maps.tsx
export type MapsTab = {
  id: string;
  title: string;
  kind: "maps";
  disclaimer?: string; // line of small print shown at the very top of the tab
  rows?: number[]; // how many maps per row, repeating: [2, 1, 2, 2] = two, one wide, two, two, then again
  aspect?: { [mapsInRow: number]: string }; // default tile shape by row type, e.g. { 1: "2 / 1", 2: "4 / 3" }
  maps: MapItem[];
};

export type PortfolioTab = BentoTab | MapsTab;

export const PORTFOLIO: PortfolioTab[] = [
  {
    id: "type",
    title: "Type Design",
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
    id: "branding",
    title: "Branding",
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
    id: "product",
    title: "Product Design",
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

  // ---------------------------------------------------------------------
  //  MAPS TAB: zoomable / pannable transit diagrams.
  //  Put PDFs (or PNG / SVG / WebP images) in public/maps/ and fill in `src`.
  //  Maps without `src` show a grey placeholder so you can see the layout.
  //
  //  Layout: `rows` says how many maps go in each row, and the pattern repeats.
  //  [2, 1, 2, 2] = row 1 has two maps, row 2 has one full-width map,
  //  rows 3 and 4 have two each, then row 5 starts the pattern again.
  //  Maps fill rows in the order they are listed below.
  // ---------------------------------------------------------------------
  {
    id: "maps",
    title: "Maps",
    kind: "maps",
    disclaimer:
      "An unofficial and unaffiliated personal project to design custom transit diagrams. Any names or iconography used are for informational purposes only. All trademarks belong to their respective owners.",
    rows: [2, 1, 2, 2],
    aspect: { 1: "2 / 1.5", 2: "4 / 3" }, // tile shape for a full-width row and a two-up row
    maps: [
      { title: "NYC Subway", src: "/maps/subway-2026.pdf", bg:"000000"}, // replace with e.g. "/maps/my-map.pdf"
      { title: "North Jersey", src: "/maps/2026_NJ.pdf", bg:"000000"},
      { title: "NYC Area", src: "/maps/0719_NYC_rail.pdf", bg:"000000"}, // full width
      { title: "Amtrak", src: "/maps/2026_Amtrak.pdf", bg:"000000"},
      { title: "San Francisco", src: "/maps/2026_BART.pdf", bg:"000000"},
      { title: "Chicago", src: "/maps/2026_Chicago.pdf", bg:"000000"},
      { title: "Washington DC", src: "/maps/2026-DCmetro.pdf", bg:"000000"},
      { title: "NYC Ferry", src: "/maps/NYC Ferry Network.pdf", bg:"000000"},
      { title: "Seoul Line 1", src: "/maps/seoul1.pdf", bg:"000000"}
    ],
  },
];
