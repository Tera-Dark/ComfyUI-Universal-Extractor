export type WorkspaceTab = "gallery" | "library" | "workbench" | "settings";

export interface GallerySource {
  id: string;
  name: string;
  kind: "output" | "input" | "custom";
  path: string;
  enabled: boolean;
  writable: boolean;
  recursive: boolean;
  import_target: boolean;
  exists: boolean;
  image_count?: number;
  locked?: boolean;
}

export interface GallerySourceDiagnostic extends GallerySource {
  status: "ok" | "missing" | "error" | "unreadable" | "write_blocked" | "overlap";
  readable: boolean;
  writable_actual: boolean;
  configured_writable: boolean;
  directory_count: number;
  free_bytes: number | null;
  total_bytes: number | null;
  overlaps: string[];
  error: string;
}

export interface MoveTargetOption {
  value: string;
  source_id: string;
  source_name: string;
  subfolder: string;
  label: string;
}

export interface ImageRecord {
  filename: string;
  relative_path: string;
  subfolder: string;
  url: string;
  original_url: string;
  thumb_url: string;
  size: number;
  created_at: number;
  favorite: boolean;
  pinned: boolean;
  boards: string[];
  category: string;
  title: string;
  notes: string;
  source_id?: string;
  source_name?: string;
  source_kind?: string;
  source_path?: string;
  source_relative_path?: string;
}

export interface PromptSummary {
  positive_prompt: string;
  negative_prompt: string;
  size: string;
  seed: number | string | null;
  steps: number | string | null;
  sampler: string;
  cfg: number | string | null;
  scheduler: string;
  denoise: number | string | null;
}

export interface ImageState {
  favorite: boolean;
  pinned: boolean;
  boards: string[];
  category: string;
  title: string;
  notes: string;
  updated_at: number;
}

export interface ImageMetadata {
  filename: string;
  relative_path: string;
  metadata: Record<string, unknown> | null;
  workflow: Record<string, unknown> | null;
  artist_prompts: string[];
  summary: PromptSummary;
  state: ImageState;
  source_id?: string;
  source_relative_path?: string;
}

export interface LibraryInfo {
  filename: string;
  count: number;
  size: number;
}

export interface LibraryEntry {
  title?: string;
  prompt?: string;
  name?: string;
  model?: string;
  tags?: string[];
  other_names?: string[] | string;
  post_count?: number;
  danbooru_url?: string;
  description?: string;
  [key: string]: unknown;
}

export type LibraryImportMode = "create" | "replace" | "merge";

export interface LibraryValidationIssue {
  index: number | null;
  field: string | null;
  message: string;
}

export interface LibraryMutationResult {
  ok: boolean;
  name: string;
  count: number;
  mode?: LibraryImportMode;
  validation_errors?: LibraryValidationIssue[];
}

export interface ImageListResponse {
  images: ImageRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface LibraryResponse {
  name: string;
  data: LibraryEntry[];
}

export interface LibraryPagedEntry extends LibraryEntry {
  source_index: number;
}

export interface LibraryEntriesPageResponse {
  name: string;
  data: LibraryPagedEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface GalleryContext {
  base_dir: string;
  output_dir_absolute: string;
  output_dir_relative: string;
  import_image_subfolder: string;
  import_image_target_relative: string;
  categories: string[];
  subfolders: string[];
  move_targets: MoveTargetOption[];
  sources: GallerySource[];
  active_source_count: number;
  pinned_count: number;
  boards: BoardSummary[];
}

export interface BoardCoverImage {
  relative_path: string;
  url: string;
  thumb_url: string;
}

export interface BoardSummary {
  id: string;
  name: string;
  description: string;
  cover: string;
  cover_image: BoardCoverImage | null;
  count: number;
  created_at: number;
  updated_at: number;
}

export interface ImportResult {
  ok: boolean;
  imported_images: Array<{ filename: string; relative_path: string }>;
  imported_libraries: Array<{ filename: string }>;
  skipped: Array<{ filename: string; reason: string }>;
}

export interface BatchUpdateResult {
  ok: boolean;
  updated: string[];
  last_state: ImageState | null;
  categories: string[];
  boards?: BoardSummary[];
}

export interface DeleteImagesResult {
  ok: boolean;
  deleted: string[];
  missing: string[];
  categories: string[];
}

export interface MoveImagesResult {
  ok: boolean;
  moved: string[];
  missing: string[];
  blocked?: string[];
  categories: string[];
  subfolders: string[];
  target_source_id?: string;
  target_subfolder?: string;
}

export interface FolderMutationResult {
  ok: boolean;
  path?: string;
  source_path?: string;
  target_path?: string;
  moved?: number;
  subfolders: string[];
  categories?: string[];
}

export interface BoardMutationResult {
  ok: boolean;
  board?: BoardSummary;
  boards: BoardSummary[];
  categories?: string[];
  updated?: string[];
  id?: string;
}

export interface TrashItem {
  id: string;
  kind: "image" | "folder" | "library";
  name: string;
  original_path: string;
  storage_path: string;
  deleted_at: number;
  image_count?: number;
  url?: string;
  original_url?: string;
  thumb_url?: string;
  size?: number;
  relative_path?: string;
}

export interface DetailNavigationState {
  items: ImageRecord[];
  currentIndex: number;
}
