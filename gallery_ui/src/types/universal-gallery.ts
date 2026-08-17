export type WorkspaceTab = "gallery" | "library" | "workbench" | "settings";

export interface UiPreferences {
  defaultSelectionMode: boolean;
  confirmWorkflowSend: boolean;
  collapseSidebarOnLaunch: boolean;
  enableImagePrefetch: boolean;
  enableLiveGalleryRefresh: boolean;
  defaultFolderTreeView: boolean;
}

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
  width?: number;
  height?: number;
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
  dominant_color?: string;
  color_family?: string;
  color_families?: string[];
  color_family_scores?: Record<string, number>;
  palette?: string[];
  color_saturation?: number;
  color_luma?: number;
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

export interface ImageRecipeLora {
  name: string;
  strength_model: number | string | null;
  strength_clip: number | string | null;
}

export interface ImageRecipeLoraManagerItem extends ImageRecipeLora {
  enabled: boolean;
}

export interface ImageRecipeLoraManager {
  detected: boolean;
  raw_stack: string;
  loras: ImageRecipeLoraManagerItem[];
}

export interface ImageRecipe {
  source_format: string;
  has_workflow: boolean;
  positive_prompt: string;
  negative_prompt: string;
  checkpoint: string;
  loras: ImageRecipeLora[];
  width: number | string | null;
  height: number | string | null;
  seed: number | string | null;
  steps: number | string | null;
  cfg: number | string | null;
  sampler: string;
  scheduler: string;
  denoise: number | string | null;
  lora_manager: ImageRecipeLoraManager;
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
  recipe?: ImageRecipe;
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
  color_index_status?: ColorIndexStatus;
  index_error?: string;
  diagnostics?: GallerySourceDiagnostic[];
}

export interface ImageFreshness {
  fingerprint: string;
  changed: boolean;
  image_count: number;
  latest_created_at: number;
  latest_relative_path: string;
  checked_at: number;
  subfolder: string;
}

export interface ColorIndexStatus {
  running: boolean;
  queued: number;
  total: number;
  indexed: number;
  missing: number;
  complete: boolean;
  version: string;
  target_version?: string;
  threshold: number;
}

export interface ThumbnailPrewarmStatus {
  pending: number;
  queued: number;
  completed: number;
  failed: number;
  last_error: string;
  updated_at: number;
}

export interface UpdateRelease {
  version: string;
  tag_name: string;
  name: string;
  body: string;
  url: string;
  published_at: string;
}

export interface UpdateStatus {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_url: string;
  repository_url: string;
  checked_at: number;
  error: string;
  releases: UpdateRelease[];
}

export type VariantGroupType =
  | "exact_duplicate"
  | "near_duplicate"
  | "same_prompt"
  | "same_workflow"
  | "filename_series";

export interface FingerprintIndexStatus {
  total: number;
  indexed: number;
  pending: number;
  failed: number;
  last_error: string;
  version: string;
}

export interface VariantGroup {
  id: string;
  type: VariantGroupType;
  title: string;
  count: number;
  cover_image: ImageRecord;
  latest_created_at: number;
  confidence: number;
  images_preview: ImageRecord[];
}

export interface VariantGroupResponse {
  groups: VariantGroup[];
  total: number;
  fingerprint_status: FingerprintIndexStatus;
  sync_status?: {
    queued: number;
    completed: number;
    failed: number;
    last_error: string;
  };
  source_signature?: string;
}

export interface VariantGroupImagesResponse {
  group: VariantGroup | null;
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
  subfolder_details?: Array<{
    path: string;
    source_id: string;
    relative_path: string;
    modified_at: number;
  }>;
  move_targets: MoveTargetOption[];
  sources: GallerySource[];
  active_source_count: number;
  pinned_count: number;
  color_index_status?: ColorIndexStatus;
  boards: BoardSummary[];
  index_error?: string;
  diagnostics?: GallerySourceDiagnostic[];
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
