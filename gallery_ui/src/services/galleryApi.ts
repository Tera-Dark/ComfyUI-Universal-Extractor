import type {
  BatchUpdateResult,
  DeleteImagesResult,
  FolderMutationResult,
  GalleryContext,
  ImageListResponse,
  ImageMetadata,
  ImportResult,
  LibraryEntriesPageResponse,
  LibraryImportMode,
  LibraryMutationResult,
  LibraryEntry,
  LibraryInfo,
  LibraryResponse,
  MoveImagesResult,
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
    dateFrom = "",
    dateTo = "",
    favoritesOnly = false,
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
    if (dateFrom.trim()) {
      params.set("date_from", dateFrom.trim());
    }
    if (dateTo.trim()) {
      params.set("date_to", dateTo.trim());
    }
    if (favoritesOnly) {
      params.set("favorites", "true");
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

  async updateImageState(relativePath: string, updates: Record<string, unknown>) {
    return requestJson<{ ok: boolean; state: ImageMetadata["state"]; categories: string[] }>(
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

  async importFiles(files: File[]) {
    const formData = new FormData();
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

  async moveImages(relativePaths: string[], targetSubfolder: string) {
    return requestJson<MoveImagesResult>("/universal_gallery/api/images/move", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ relative_paths: relativePaths, target_subfolder: targetSubfolder }),
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
};
