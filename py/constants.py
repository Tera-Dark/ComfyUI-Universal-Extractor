import os


PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PLUGIN_DIR, "data")
GALLERY_UI_DIR = os.path.join(PLUGIN_DIR, "gallery_ui", "dist")
GALLERY_INDEX_FILE = os.path.join(GALLERY_UI_DIR, "index.html")
GALLERY_STATE_FILE = os.path.join(DATA_DIR, "gallery_state.json")
THUMB_CACHE_DIR = os.path.join(DATA_DIR, "thumb_cache")
TRASH_DIR = os.path.join(DATA_DIR, "trash")
TRASH_STATE_FILE = os.path.join(DATA_DIR, "trash_state.json")

IMPORT_IMAGE_SUBFOLDER = "universal_gallery_imports"
SUPPORTED_IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
SUPPORTED_LIBRARY_EXTENSIONS = (".json",)
