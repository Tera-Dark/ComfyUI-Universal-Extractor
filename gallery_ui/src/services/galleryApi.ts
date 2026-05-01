import type {
  BatchUpdateResult,
  BoardMutationResult,
  BoardSummary,
  DeleteImagesResult,
  FolderMutationResult,
  GalleryContext,
  GallerySource,
  GallerySourceDiagnostic,
  ImageListResponse,
  ImageMetadata,
  ImportResult,
  ColorIndexStatus,
  LibraryEntriesPageResponse,
  LibraryImportMode,
  LibraryMutationResult,
  LibraryEntry,
  LibraryInfo,
  LibraryResponse,
  MoveImagesResult,
  ThumbnailPrewarmStatus,
  TrashItem,
} from "../types/universal-gallery";

export class ApiRequestError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.details = details;
  }
}

const requestJson = async <T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init);
  if (!response.ok) {
    let details: unknown = null;
    try {
      details = await response.json();
    } catch {
      try {
        details = await response.text();
      } catch {
        details = null;
      }
    }

    const message =
      typeof details === "object" &&
      details !== null &&
      "error" in details &&
      typeof (details as { error?: unknown }).error === "string"
        ? (details as { error: string }).error
        : `Request failed: ${response.status}`;

    throw new ApiRequestError(message, response.status, details);
  }
  return response.json() as Promise<T>;
};

export const galleryApi = {
  async getContext(forceRefresh = false) {
    const params = new URLSearchParams();
    if (forceRefresh) {
      params.set("force_refresh", "true");
    }
    const query = params.size ? `?${params}` : "";
    return requestJson<GalleryContext>(`/universal_gallery/api/context${query}`);
  },

  async listImages(
    page: number,
    limit: number,
    search: string,
    category = "",
    subfolder = "",
    boardId = "",
    dateFrom = "",
    dateTo = "",
    favoritesOnly = false,
    colorFamily = "",
    sortBy = "created_at",
    sortOrder = "desc",
    forceRefresh = false,
  ) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (search.trim()) {
      params.set("search", search.trim());
    }
    if (category.trim()) {
      params.set("category", category.trim());
    }
    if (subfolder.trim()) {
      params.set("subfolder", subfolder.trim());
    }
    if (boardId.trim()) {
      params.set("board_id", boardId.trim());
    }
    if (dateFrom.trim()) {
      params.set("date_from", dateFrom.trim());
    }
    if (dateTo.trim()) {
      params.set("date_to", dateTo.trim());
    }
    if (favoritesOnly) {
      params.set("pinned", "true");
    }
    if (colorFamily.trim()) {
      params.set("color_family", colorFamily.trim());
    }
    params.set("sort_by", sortBy);
    params.set("sort_order", sortOrder);
    if (forceRefresh) {
      params.set("force_refresh", "true");
    }

    return requestJson<ImageListResponse>(`/universal_gallery/api/images?${params}`);
  },

  async getImageMetadata(relativePath: string) {
    return requestJson<ImageMetadata>(
      `/universal_gallery/api/metadata?relative_path=${encodeURIComponent(relativePath)}`,
    );
  },

  async prewarmThumbnails(relativePaths: string[], limit = 80) {
    return requestJson<{
      ok: boolean;
      queued: string[];
      skipped: string[];
      status: ThumbnailPrewarmStatus;
    }>("/universal_gallery/api/thumb/prewarm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ relative_paths: relativePaths, limit }),
    });
  },

  async getThumbnailPrewarmStatus() {
    return requestJson<ThumbnailPrewarmStatus>("/universal_gallery/api/thumb/prewarm-status");
  },

  async getColorIndexStatus() {
    return requestJson<ColorIndexStatus>("/universal_gallery/api/color-index/status");
  },

  async updateImageState(relativePath: string, updates: Record<string, unknown>) {
    return requestJson<{ ok: boolean; state: ImageMetadata["state"]; categories: string[]; boards?: BoardSummary[] }>(
      "/universal_gallery/api/image-state",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ relative_path: relativePath, updates }),
      },
    );
  },

  async importFiles(files: File[], targetSourceId = "", targetSubfolder = "universal_gallery_imports") {
    const formData = new FormData();
    if (targetSourceId.trim()) {
      formData.append("target_source_id", targetSourceId.trim());
    }
    if (targetSubfolder.trim()) {
      formData.append("target_subfolder", targetSubfolder.trim());
    }
    files.forEach((file) => {
      formData.append("files", file, file.name);
    });

    return requestJson<ImportResult>("/universal_gallery/api/import", {
      method: "POST",
      body: formData,
    });
  },

  async deleteImages(relativePaths: string[]) {
    return requestJson<DeleteImagesResult>("/universal_gallery/api/images/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ relative_paths: relativePaths }),
    });
  },

  async batchUpdateImages(relativePaths: string[], updates: Record<string, unknown>) {
    return requestJson<BatchUpdateResult>("/universal_gallery/api/images/batch-update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ relative_paths: relativePaths, updates }),
    });
  },

  async listBoards(forceRefresh = false) {
    const params = new URLSearchParams();
    if (forceRefresh) {
      params.set("force_refresh", "true");
    }
    const query = params.size ? `?${params}` : "";
    const response = await requestJson<{ boards?: BoardSummary[] }>(`/universal_gallery/api/boards${query}`);
    return response.boards ?? [];
  },

  async createBoard(name: string, description = "") {
    return requestJson<BoardMutationResult>("/universal_gallery/api/boards", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, description }),
    });
  },

  async updateBoard(id: string, updates: Record<string, unknown>) {
    return requestJson<BoardMutationResult>("/universal_gallery/api/boards", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, updates }),
    });
  },

  async deleteBoard(id: string) {
    return requestJson<BoardMutationResult>("/universal_gallery/api/boards", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id }),
    });
  },

  async updateBoardPins(id: string, relativePaths: string[], pinned = true) {
    return requestJson<BoardMutationResult>("/universal_gallery/api/boards/pins", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, relative_paths: relativePaths, pinned }),
    });
  },

  async moveImages(relativePaths: string[], targetSubfolder: string, targetSourceId = "") {
    return requestJson<MoveImagesResult>("/universal_gallery/api/images/move", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        relative_paths: relativePaths,
        target_subfolder: targetSubfolder,
        target_source_id: targetSourceId,
      }),
    });
  },

  async renameImage(relativePath: string, newFilename: string) {
    return requestJson<{ ok: boolean; image: ImageListResponse["images"][number]; categories: string[] }>(
      "/universal_gallery/api/images/rename",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ relative_path: relativePath, new_filename: newFilename }),
      },
    );
  },

  async batchRenameImages(relativePaths: string[], template: string, startNumber = 1, padding = 2, currentPage = 1) {
    return requestJson<{
      ok: boolean;
      renamed: string[];
      categories: string[];
    }>("/universal_gallery/api/images/batch-rename", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        relative_paths: relativePaths,
        template,
        start_number: startNumber,
        padding,
        current_page: currentPage,
      }),
    });
  },

  async listLibraries() {
    const response = await requestJson<{ libraries?: LibraryInfo[] }>("/universal_gallery/api/libraries");
    return response.libraries ?? [];
  },

  async getLibrary(name: string) {
    const response = await requestJson<LibraryResponse>(
      `/universal_gallery/api/library?name=${encodeURIComponent(name)}`,
    );
    return response.data ?? [];
  },

  async getLibraryEntries(name: string, search = "", page = 1, limit = 120) {
    const params = new URLSearchParams({
      name,
      page: String(page),
      limit: String(limit),
    });
    if (search.trim()) {
      params.set("search", search.trim());
    }
    return requestJson<LibraryEntriesPageResponse>(`/universal_gallery/api/library/entries?${params}`);
  },

  async getLibraryRaw(name: string) {
    return requestJson<{ name: string; text: string }>(
      `/universal_gallery/api/library/raw?name=${encodeURIComponent(name)}`,
    );
  },

  async searchLibraryArtists(name: string, query = "", filterMode = "none", postThreshold = 0, limit = 12) {
    const params = new URLSearchParams({
      name,
      query,
      filter_mode: filterMode,
      post_threshold: String(postThreshold),
      limit: String(limit),
    });
    return requestJson<{ name: string; total: number; data: LibraryEntry[] }>(
      `/universal_gallery/api/library/artists?${params}`,
    );
  },

  async generateArtistString(payload: {
    name: string;
    query: string;
    count: number;
    mode: string;
    preselected_names: string[];
    filter_mode: string;
    post_threshold: number;
    creative_bracket_style: string;
    creative_nest_levels: number;
    standard_weight_min: number;
    standard_weight_max: number;
    nai_weight_min: number;
    nai_weight_max: number;
    enable_custom_format: boolean;
    custom_format_string: string;
  }) {
    return requestJson<{ ok: boolean; names: string[]; formatted: string; available: number }>(
      "/universal_gallery/api/library/generate-artists",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
  },

  async saveLibrary(name: string, data: LibraryEntry[]) {
    return requestJson<LibraryMutationResult>("/universal_gallery/api/library", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, data }),
    });
  },

  async deleteLibrary(name: string) {
    return requestJson<{ ok: boolean }>(
      `/universal_gallery/api/library?name=${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
  },

  async saveLibraryEntry(name: string, entry: LibraryEntry, index?: number) {
    return requestJson<LibraryMutationResult>("/universal_gallery/api/library/entry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(index === undefined ? { name, entry } : { name, entry, index }),
    });
  },

  async deleteLibraryEntry(name: string, index: number) {
    return requestJson<LibraryMutationResult>("/universal_gallery/api/library/entry", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, index }),
    });
  },

  async createFolder(path: string) {
    return requestJson<FolderMutationResult>("/universal_gallery/api/folders/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path }),
    });
  },

  async deleteFolder(path: string) {
    return requestJson<FolderMutationResult>("/universal_gallery/api/folders/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path }),
    });
  },

  async mergeFolder(sourcePath: string, targetPath: string) {
    return requestJson<FolderMutationResult>("/universal_gallery/api/folders/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source_path: sourcePath, target_path: targetPath }),
    });
  },

  async renameFolder(sourcePath: string, targetPath: string) {
    return requestJson<FolderMutationResult>("/universal_gallery/api/folders/rename", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source_path: sourcePath, target_path: targetPath }),
    });
  },

  async importLibrary(file: File, mode: LibraryImportMode, targetName = "", newName = "") {
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("mode", mode);
    if (targetName.trim()) {
      formData.append("target_name", targetName.trim());
    }
    if (newName.trim()) {
      formData.append("new_name", newName.trim());
    }

    return requestJson<LibraryMutationResult>("/universal_gallery/api/library/import", {
      method: "POST",
      body: formData,
    });
  },

  async listTrash() {
    const response = await requestJson<{ items?: TrashItem[] }>("/universal_gallery/api/trash");
    return response.items ?? [];
  },

  async restoreTrashItem(id: string) {
    return requestJson<{ ok: boolean }>("/universal_gallery/api/trash/restore", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id }),
    });
  },

  async purgeTrashItem(id: string) {
    return requestJson<{ ok: boolean }>("/universal_gallery/api/trash/purge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id }),
    });
  },

  async listGallerySources(forceRefresh = false) {
    const params = new URLSearchParams();
    if (forceRefresh) {
      params.set("force_refresh", "true");
    }
    const query = params.size ? `?${params}` : "";
    const response = await requestJson<{ sources?: GallerySource[]; active_source_count?: number }>(
      `/universal_gallery/api/settings/gallery-sources${query}`,
    );
    return response.sources ?? [];
  },

  async saveGallerySource(source: Partial<GallerySource>) {
    return requestJson<{ ok: boolean; source: GallerySource; sources: GallerySource[] }>(
      "/universal_gallery/api/settings/gallery-sources",
      {
        method: source.id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(source),
      },
    );
  },

  async deleteGallerySource(id: string) {
    return requestJson<{ ok: boolean; id: string; sources: GallerySource[] }>(
      "/universal_gallery/api/settings/gallery-sources",
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      },
    );
  },

  async testGallerySourcePath(path: string) {
    return requestJson<{ ok: boolean; path: string; exists: boolean; writable: boolean; image_count: number }>(
      "/universal_gallery/api/settings/gallery-sources/test-path",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path }),
      },
    );
  },

  async diagnoseGallerySources() {
    const response = await requestJson<{ ok: boolean; sources?: GallerySourceDiagnostic[] }>(
      "/universal_gallery/api/settings/gallery-sources/diagnostics",
    );
    return response.sources ?? [];
  },
};
