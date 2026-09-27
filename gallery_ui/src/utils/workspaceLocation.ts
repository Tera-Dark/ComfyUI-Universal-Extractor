import type { WorkspaceTab } from "../types/universal-gallery";

export interface GalleryUrlScope {
  folder: string;
  board: string;
  query: string;
  category: string;
  dateFrom: string;
  dateTo: string;
  favorites: boolean;
  color: string;
  sort: string;
  order: string;
  page: number;
}

export interface WorkspaceLocation {
  tab: WorkspaceTab;
  library: string;
  gallery: GalleryUrlScope;
}

export const DEFAULT_GALLERY_SCOPE: GalleryUrlScope = {
  folder: "default_output::", board: "", query: "", category: "", dateFrom: "", dateTo: "",
  favorites: false, color: "", sort: "created_at", order: "desc", page: 1,
};

const OWNED_KEYS = ["tab", "library", "folder", "board", "q", "category", "from", "to", "pinned", "color", "sort", "order", "page"];
const bounded = (value: string | null) => (value || "").slice(0, 256);
const validDate = (value: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value! : "";

export const readWorkspaceLocation = (search: string): WorkspaceLocation => {
  const params = new URLSearchParams(search);
  const rawTab = params.get("tab");
  const tab: WorkspaceTab = rawTab === "library" || rawTab === "workbench" || rawTab === "settings" ? rawTab : "gallery";
  const rawPage = Number(params.get("page") || 1);
  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 100_000 ? rawPage : 1;
  const sort = params.get("sort");
  const order = params.get("order");
  const board = bounded(params.get("board"));
  const favorites = params.get("pinned") === "1";
  const folder = bounded(params.get("folder")) || (board || favorites ? "" : DEFAULT_GALLERY_SCOPE.folder);
  return {
    tab,
    library: bounded(params.get("library")),
    gallery: {
      folder, board, query: bounded(params.get("q")), category: bounded(params.get("category")),
      dateFrom: validDate(params.get("from")), dateTo: validDate(params.get("to")),
      favorites, color: bounded(params.get("color")),
      sort: sort === "filename" || sort === "size" ? sort : DEFAULT_GALLERY_SCOPE.sort,
      order: order === "asc" ? "asc" : DEFAULT_GALLERY_SCOPE.order,
      page,
    },
  };
};

export const buildWorkspaceUrl = (baseHref: string, state: WorkspaceLocation): string => {
  const url = new URL(baseHref);
  OWNED_KEYS.forEach((key) => url.searchParams.delete(key));
  const set = (key: string, value: string | number | boolean, defaultValue: string | number | boolean) => {
    if (value !== defaultValue && value !== "") url.searchParams.set(key, String(value));
  };
  set("tab", state.tab, "gallery");
  if (state.tab === "library" || state.tab === "workbench") set("library", state.library, "");
  set("folder", state.gallery.folder, DEFAULT_GALLERY_SCOPE.folder);
  set("board", state.gallery.board, "");
  set("q", state.gallery.query, "");
  set("category", state.gallery.category, "");
  set("from", state.gallery.dateFrom, "");
  set("to", state.gallery.dateTo, "");
  if (state.gallery.favorites) url.searchParams.set("pinned", "1");
  set("color", state.gallery.color, "");
  set("sort", state.gallery.sort, DEFAULT_GALLERY_SCOPE.sort);
  set("order", state.gallery.order, DEFAULT_GALLERY_SCOPE.order);
  set("page", state.gallery.page, 1);
  return `${url.pathname}${url.search}${url.hash}`;
};

// Typing replaces the current history entry; scope/page/workspace changes add
// an entry so Back/Forward retrace meaningful browsing steps, not every keystroke.
export const isSearchOnlyLocationChange = (before: WorkspaceLocation, after: WorkspaceLocation) => {
  const removeSearch = (value: WorkspaceLocation) => ({ ...value, gallery: { ...value.gallery, query: "" } });
  return before.gallery.query !== after.gallery.query &&
    JSON.stringify(removeSearch(before)) === JSON.stringify(removeSearch(after));
};
