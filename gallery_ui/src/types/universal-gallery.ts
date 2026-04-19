export type WorkspaceTab = "gallery" | "library" | "workbench";

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
  category: string;
  title: string;
  notes: string;
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
  categories: string[];
  subfolders: string[];
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
