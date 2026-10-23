from __future__ import annotations

import hashlib
import colorsys
import json
import os
import sqlite3
import shutil
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import BoundedSemaphore, Lock, RLock
from typing import Any

from ..constants import (
    DATA_DIR,
    GALLERY_SOURCES_FILE,
    IMPORT_IMAGE_SUBFOLDER,
    SUPPORTED_IMAGE_EXTENSIONS,
    SUPPORTED_LIBRARY_EXTENSIONS,
    RUNTIME_STATE_FILENAMES,
    THUMB_CACHE_DIR,
    TRASH_DIR,
)
from ..paths import (
    build_relative_display,
    ensure_data_dir,
    ensure_unique_path,
    ensure_trash_dir,
    get_comfy_base_dir,
    get_input_dir,
    get_output_dir,
    load_json,
    load_trash_state,
    normalize_relative_path,
    save_json,
    save_trash_state,
    to_posix,
)
from .similarity import near_hash_pairs
from .sqlite_batch import ClosingConnection, iter_sqlite_batches
from .metadata import read_image_metadata
from .file_transactions import FILE_OPERATION_LOCK, execute_moves
from . import state_store as _state_store
from .recipe import build_prompt_summary, extract_artist_prompts, extract_generation_recipe
from .image_safety import DecompressionBombError, extract_rgba_pixels, guarded_image_open
from .variant_fingerprints import (
    FINGERPRINT_VERSION,
    build_image_fingerprint,
    hamming_distance_hex,
)
from .refs import (
    DEFAULT_INPUT_SOURCE_ID,
    DEFAULT_OUTPUT_SOURCE_ID,
    IMAGE_REF_SEPARATOR,
    make_folder_ref,
    make_image_ref,
    parse_folder_ref,
    parse_image_ref,
    sanitize_source_id as _sanitize_source_id,
)
from .source_security import (
    ensure_supported_image_path as _ensure_supported_image_path,
    ensure_within_directory as _ensure_within_directory,
    env_flag as _env_flag,
    external_sources_allowed as _external_sources_allowed,
    harden_source as _harden_source,
    path_is_within_any as _path_is_within_any,
    real_abs as _real_abs,
    safe_source_roots as _safe_source_roots,
    validate_source_path as _validate_source_path,
)
from .state_store import (
    collect_categories,
    create_board,
    delete_board,
    default_image_state,
    extract_image_states,
    extract_image_states_by_prefix,
    get_image_state_map,
    get_image_state,
    get_raw_boards,
    migrate_missing_image_states,
    move_image_states,
    normalize_board_ids,
    remove_image_states,
    remove_image_states_by_prefix,
    rename_image_state,
    restore_image_states,
    set_image_board_membership,
    update_board,
    update_image_state,
)

try:
    from PIL import Image

    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def _env_positive_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


THUMB_SIZE = 480
GALLERY_INDEX_DB_FILE = os.path.join(DATA_DIR, "gallery_index.sqlite3")
GALLERY_INDEX_SCHEMA_VERSION = 11
COLOR_INDEX_VERSION = "3"
DIMENSION_INDEX_VERSION = "1"
COLOR_FAMILY_MIN_RATIO = 0.25
NEAR_DUPLICATE_HASH_DISTANCE = 5
VARIANT_GROUP_SCAN_LIMIT = 2000
FINGERPRINT_SYNC_LIMIT = 360
IMAGE_FRESHNESS_CACHE_TTL_SECONDS = 3.0
IMAGE_FRESHNESS_CACHE_MAX_SCOPES = 32
GALLERY_INDEX_BUSY_TIMEOUT_MS = _env_positive_int("UNIVERSAL_EXTRACTOR_SQLITE_BUSY_TIMEOUT_MS", 5000)
GALLERY_INDEX_CORRUPTION_MARKERS = (
    "database disk image is malformed",
    "file is not a database",
    "file is encrypted or is not a database",
    "database schema is corrupt",
)
IMAGE_INDEX_CACHE: dict[str, Any] = {
    "signature": None,
    "output_dir": None,
    "built_at": 0.0,
    "images": [],
    "subfolders": [],
    "sources": [],
    "dirty": False,
}
IMAGE_INDEX_LOCK = Lock()
IMAGE_FRESHNESS_CACHE: dict[str, dict[str, Any]] = {}
IMAGE_FRESHNESS_LOCK = Lock()
LIBRARY_CACHE: dict[str, dict[str, Any]] = {}
LIBRARY_CACHE_LOCK = Lock()
LIBRARY_SUMMARY_CACHE_FILE = os.path.join(DATA_DIR, "library_summary_cache.json")
LIBRARY_SUMMARY_CACHE: dict[str, dict[str, Any]] = {}
LIBRARY_SUMMARY_CACHE_LOADED = False
LIBRARY_SUMMARY_CACHE_DIRTY = False
LIBRARY_SUMMARY_CACHE_LOCK = Lock()
THUMB_GENERATION_SEMAPHORE = BoundedSemaphore(2)
THUMB_LOCKS: dict[str, Lock] = {}
THUMB_LOCKS_GUARD = Lock()

COLOR_PROFILE_DEFAULT = {
    "dominant_color": "",
    "color_family": "",
    "color_families_text": "",
    "color_family_scores_json": "{}",
    "palette_json": "[]",
    "color_saturation": 0.0,
    "color_luma": 0.0,
}
THUMB_PREWARM_PENDING: set[str] = set()
THUMB_PREWARM_LOCK = Lock()
THUMB_PREWARM_STATS: dict[str, Any] = {
    "queued": 0,
    "completed": 0,
    "failed": 0,
    "last_error": "",
    "updated_at": 0.0,
}
MAX_ARTIST_SEARCH_RESULTS = 5000
COLOR_INDEX_BACKFILL_LOCK = Lock()
COLOR_INDEX_BACKFILL_RUNNING = False
COLOR_INDEX_QUEUED_PATHS: set[str] = set()
DIMENSION_BACKFILL_LOCK = Lock()
DIMENSION_BACKFILL_RUNNING = False


class LibraryValidationError(ValueError):
    def __init__(self, issues: list[dict[str, Any]]):
        super().__init__("library validation failed")
        self.issues = issues



from functools import partial as _partial
from .environment import ServiceEnvironment
from . import media_service, sources, file_ops, libraries, indexing

_environment = ServiceEnvironment(globals())

# media_service compatibility exports
_read_image_dimensions = _partial(media_service._read_image_dimensions, _environment)
_rgb_to_hex = _partial(media_service._rgb_to_hex, _environment)
_color_family_from_rgb = _partial(media_service._color_family_from_rgb, _environment)
_encode_color_families = _partial(media_service._encode_color_families, _environment)
_thumb_cache_path_if_exists = _partial(media_service._thumb_cache_path_if_exists, _environment)
_extract_image_color_profile = _partial(media_service._extract_image_color_profile, _environment)
_color_index_is_current = _partial(media_service._color_index_is_current, _environment)
_schedule_dimension_backfill = _partial(media_service._schedule_dimension_backfill, _environment)
_schedule_dimension_backfill_if_needed = _partial(media_service._schedule_dimension_backfill_if_needed, _environment)
_schedule_color_index_backfill = _partial(media_service._schedule_color_index_backfill, _environment)
_full_path_for_index_row = _partial(media_service._full_path_for_index_row, _environment)
_fingerprint_row_current = _partial(media_service._fingerprint_row_current, _environment)
_lookup_fingerprint_rows = _partial(media_service._lookup_fingerprint_rows, _environment)
_sync_fingerprints_for_rows = _partial(media_service._sync_fingerprints_for_rows, _environment)
_rows_with_fingerprints = _partial(media_service._rows_with_fingerprints, _environment)
_variant_group_id = _partial(media_service._variant_group_id, _environment)
_variant_group_title = _partial(media_service._variant_group_title, _environment)
_build_variant_groups_from_items = _partial(media_service._build_variant_groups_from_items, _environment)
_variant_items_for_rows = _partial(media_service._variant_items_for_rows, _environment)
list_variant_groups = _partial(media_service.list_variant_groups, _environment)
get_variant_group_images = _partial(media_service.get_variant_group_images, _environment)
prewarm_image_fingerprints = _partial(media_service.prewarm_image_fingerprints, _environment)
get_fingerprint_index_status = _partial(media_service.get_fingerprint_index_status, _environment)
get_image_metadata = _partial(media_service.get_image_metadata, _environment)
ensure_thumb_cache_dir = _partial(media_service.ensure_thumb_cache_dir, _environment)
_get_thumb_generation_lock = _partial(media_service._get_thumb_generation_lock, _environment)
get_thumbnail_path = _partial(media_service.get_thumbnail_path, _environment)
_thumbnail_prewarm_key = _partial(media_service._thumbnail_prewarm_key, _environment)
_run_thumbnail_prewarm = _partial(media_service._run_thumbnail_prewarm, _environment)
enqueue_thumbnail_prewarm = _partial(media_service.enqueue_thumbnail_prewarm, _environment)
get_thumbnail_prewarm_status = _partial(media_service.get_thumbnail_prewarm_status, _environment)

# sources compatibility exports
_default_gallery_sources = _partial(sources._default_gallery_sources, _environment)
_source_exists = _partial(sources._source_exists, _environment)
_normalize_source = _partial(sources._normalize_source, _environment)
_load_gallery_sources_file = _partial(sources._load_gallery_sources_file, _environment)
_write_gallery_sources_file = _partial(sources._write_gallery_sources_file, _environment)
list_gallery_sources = _partial(sources.list_gallery_sources, _environment)
_source_signature = _partial(sources._source_signature, _environment)
get_gallery_source = _partial(sources.get_gallery_source, _environment)
save_gallery_source = _partial(sources.save_gallery_source, _environment)
delete_gallery_source = _partial(sources.delete_gallery_source, _environment)
test_gallery_source_path = _partial(sources.test_gallery_source_path, _environment)
diagnose_gallery_sources = _partial(sources.diagnose_gallery_sources, _environment)
image_ref_for_full_path = _partial(sources.image_ref_for_full_path, _environment)
_ensure_output_dir = _partial(sources._ensure_output_dir, _environment)
_ensure_within_output = _partial(sources._ensure_within_output, _environment)
resolve_subfolder_path = _partial(sources.resolve_subfolder_path, _environment)
_resolve_folder_ref_path = _partial(sources._resolve_folder_ref_path, _environment)
_normalize_folder_ref_for_source = _partial(sources._normalize_folder_ref_for_source, _environment)
_image_state_folder_prefix = _partial(sources._image_state_folder_prefix, _environment)
_coerce_target_folder_ref = _partial(sources._coerce_target_folder_ref, _environment)
resolve_source_subfolder_path = _partial(sources.resolve_source_subfolder_path, _environment)
resolve_image_path = _partial(sources.resolve_image_path, _environment)
build_view_url = _partial(sources.build_view_url, _environment)
build_thumb_url = _partial(sources.build_thumb_url, _environment)
_collect_index_subfolders = _partial(sources._collect_index_subfolders, _environment)
_folder_ref_key = _partial(sources._folder_ref_key, _environment)
_merge_subfolder_refs = _partial(sources._merge_subfolder_refs, _environment)
_collect_directory_subfolder_details = _partial(sources._collect_directory_subfolder_details, _environment)
_collect_directory_subfolders = _partial(sources._collect_directory_subfolders, _environment)
build_move_target_options = _partial(sources.build_move_target_options, _environment)

# file_ops compatibility exports
ensure_trash_storage_dir = _partial(file_ops.ensure_trash_storage_dir, _environment)
send_to_system_recycle_bin = _partial(file_ops.send_to_system_recycle_bin, _environment)
add_trash_item = _partial(file_ops.add_trash_item, _environment)
list_trash_items = _partial(file_ops.list_trash_items, _environment)
get_trash_item = _partial(file_ops.get_trash_item, _environment)
remove_trash_item = _partial(file_ops.remove_trash_item, _environment)
resolve_trash_storage_path = _partial(file_ops.resolve_trash_storage_path, _environment)
move_path_to_trash = _partial(file_ops.move_path_to_trash, _environment)
restore_trash_item = _partial(file_ops.restore_trash_item, _environment)
purge_trash_item = _partial(file_ops.purge_trash_item, _environment)
get_import_target_for_filename = _partial(file_ops.get_import_target_for_filename, _environment)
build_import_result = _partial(file_ops.build_import_result, _environment)
import_files_from_parts = _partial(file_ops.import_files_from_parts, _environment)
persist_image_state = _partial(file_ops.persist_image_state, _environment)
_execute_image_moves = _partial(file_ops._execute_image_moves, _environment)
rename_image = _partial(file_ops.rename_image, _environment)
batch_rename_images = _partial(file_ops.batch_rename_images, _environment)
create_folder = _partial(file_ops.create_folder, _environment)
delete_folder = _partial(file_ops.delete_folder, _environment)
merge_folder = _partial(file_ops.merge_folder, _environment)
rename_folder = _partial(file_ops.rename_folder, _environment)
move_images = _partial(file_ops.move_images, _environment)
_trash_batch = _partial(file_ops._trash_batch, _environment)
delete_images = _partial(file_ops.delete_images, _environment)
batch_update_images = _partial(file_ops.batch_update_images, _environment)

# libraries compatibility exports
validate_library_entries = _partial(libraries.validate_library_entries, _environment)
ensure_valid_library_entries = _partial(libraries.ensure_valid_library_entries, _environment)
normalize_library_filename = _partial(libraries.normalize_library_filename, _environment)
import_library_data = _partial(libraries.import_library_data, _environment)
save_library = _partial(libraries.save_library, _environment)
list_libraries = _partial(libraries.list_libraries, _environment)
get_library = _partial(libraries.get_library, _environment)
invalidate_library_cache = _partial(libraries.invalidate_library_cache, _environment)
_load_library_summary_cache_locked = _partial(libraries._load_library_summary_cache_locked, _environment)
_save_library_summary_cache_locked = _partial(libraries._save_library_summary_cache_locked, _environment)
_get_library_summary = _partial(libraries._get_library_summary, _environment)
invalidate_library_summary_cache = _partial(libraries.invalidate_library_summary_cache, _environment)
load_library_data = _partial(libraries.load_library_data, _environment)
get_library_entries_page = _partial(libraries.get_library_entries_page, _environment)
_build_artist_candidates = _partial(libraries._build_artist_candidates, _environment)
search_library_artists = _partial(libraries.search_library_artists, _environment)
generate_artist_string = _partial(libraries.generate_artist_string, _environment)
get_library_raw_text = _partial(libraries.get_library_raw_text, _environment)
update_library_entry = _partial(libraries.update_library_entry, _environment)
create_library_entry = _partial(libraries.create_library_entry, _environment)
delete_library_entry = _partial(libraries.delete_library_entry, _environment)
delete_library = _partial(libraries.delete_library, _environment)

# indexing compatibility exports
_is_gallery_index_corruption = _partial(indexing._is_gallery_index_corruption, _environment)
_unique_gallery_index_quarantine_path = _partial(indexing._unique_gallery_index_quarantine_path, _environment)
_quarantine_gallery_index_db = _partial(indexing._quarantine_gallery_index_db, _environment)
_gallery_index_file_has_invalid_header = _partial(indexing._gallery_index_file_has_invalid_header, _environment)
_record_gallery_index_migration = _partial(indexing._record_gallery_index_migration, _environment)
_apply_gallery_index_migrations = _partial(indexing._apply_gallery_index_migrations, _environment)
_initialize_gallery_index_db = _partial(indexing._initialize_gallery_index_db, _environment)
_connect_gallery_index_db = _partial(indexing._connect_gallery_index_db, _environment)
_index_meta_get = _partial(indexing._index_meta_get, _environment)
_index_meta_set = _partial(indexing._index_meta_set, _environment)
_image_row_to_payload = _partial(indexing._image_row_to_payload, _environment)
_boards_to_search_text = _partial(indexing._boards_to_search_text, _environment)
_image_row_state = _partial(indexing._image_row_state, _environment)
_gallery_state_file_path = _partial(indexing._gallery_state_file_path, _environment)
_gallery_state_signature = _partial(indexing._gallery_state_signature, _environment)
_current_state_paths_from_db = _partial(indexing._current_state_paths_from_db, _environment)
_search_text_for_row = _partial(indexing._search_text_for_row, _environment)
_fts_match_query = _partial(indexing._fts_match_query, _environment)
_color_family_rows_for_image = _partial(indexing._color_family_rows_for_image, _environment)
_sync_auxiliary_rows = _partial(indexing._sync_auxiliary_rows, _environment)
_ensure_auxiliary_tables_current = _partial(indexing._ensure_auxiliary_tables_current, _environment)
_sync_image_state_to_index_db = _partial(indexing._sync_image_state_to_index_db, _environment)
_indexed_relative_paths = _partial(indexing._indexed_relative_paths, _environment)
_reconcile_missing_state_paths_to_index = _partial(indexing._reconcile_missing_state_paths_to_index, _environment)
_load_image_index_from_db = _partial(indexing._load_image_index_from_db, _environment)
_image_index_db_has_signature = _partial(indexing._image_index_db_has_signature, _environment)
get_color_index_status = _partial(indexing.get_color_index_status, _environment)
_save_image_index_to_db = _partial(indexing._save_image_index_to_db, _environment)
invalidate_image_index_cache = _partial(indexing.invalidate_image_index_cache, _environment)
_build_image_index = _partial(indexing._build_image_index, _environment)
_image_record_for_file = _partial(indexing._image_record_for_file, _environment)
_scan_index_records_for_scope = _partial(indexing._scan_index_records_for_scope, _environment)
_scope_where_sql = _partial(indexing._scope_where_sql, _environment)
_sync_image_index_incremental_locked = _partial(indexing._sync_image_index_incremental_locked, _environment)
ensure_image_index_db_current = _partial(indexing.ensure_image_index_db_current, _environment)
get_image_index = _partial(indexing.get_image_index, _environment)
_collect_subfolders_from_db = _partial(indexing._collect_subfolders_from_db, _environment)
collect_subfolders = _partial(indexing.collect_subfolders, _environment)
collect_subfolder_details = _partial(indexing.collect_subfolder_details, _environment)
list_images = _partial(indexing.list_images, _environment)
_freshness_scope_key = _partial(indexing._freshness_scope_key, _environment)
_freshness_sources_for_subfolder = _partial(indexing._freshness_sources_for_subfolder, _environment)
_scan_image_freshness = _partial(indexing._scan_image_freshness, _environment)
get_image_freshness = _partial(indexing.get_image_freshness, _environment)
list_images_page = _partial(indexing.list_images_page, _environment)
locate_image = _partial(indexing.locate_image, _environment)
_build_image_filter_sql = _partial(indexing._build_image_filter_sql, _environment)
_image_row_select_sql = _partial(indexing._image_row_select_sql, _environment)
_query_filtered_image_rows = _partial(indexing._query_filtered_image_rows, _environment)
_board_cover_payload = _partial(indexing._board_cover_payload, _environment)
list_boards = _partial(indexing.list_boards, _environment)
create_gallery_board = _partial(indexing.create_gallery_board, _environment)
update_gallery_board = _partial(indexing.update_gallery_board, _environment)
delete_gallery_board = _partial(indexing.delete_gallery_board, _environment)
update_board_images = _partial(indexing.update_board_images, _environment)
get_gallery_context = _partial(indexing.get_gallery_context, _environment)


_runtime = None
_RUNTIME_LOCK = RLock()


def get_runtime():
    global _runtime
    with _RUNTIME_LOCK:
        if _runtime is None or _runtime.closed:
            from .runtime import GalleryRuntime
            _runtime = GalleryRuntime(_environment)
        return _runtime


def get_asset_identity(relative_path, register=True):
    runtime = get_runtime()
    if runtime.catalog is None:
        if register:
            runtime.require_catalog()
        return {}
    source_id, source_relative = parse_image_ref(relative_path)
    source = get_gallery_source(source_id)
    identity = runtime.catalog.find(source, source_relative)
    if identity is None and register:
        _, full_path = resolve_image_path(relative_path)
        stat = os.stat(full_path)
        identity = runtime.catalog.observe_many(source, [(source_relative, stat.st_size, stat.st_mtime_ns)])[0]
    return identity or {}
