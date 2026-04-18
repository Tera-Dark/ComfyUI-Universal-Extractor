import os
import json
import glob
import urllib.parse
from aiohttp import web

try:
    import server
    import folder_paths
except ImportError:
    class _DummyPromptServer:
        instance = None
    class _DummyServer:
        PromptServer = _DummyPromptServer
    server = _DummyServer()
    class folder_paths:
        @staticmethod
        def get_output_directory():
            return ""

try:
    from PIL import Image
    from PIL.PngImagePlugin import PngInfo
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("[Universal Extractor] Warning: Pillow not found, metadata extraction disabled.")


# ────────────────────────────────────────────
#  Helpers
# ────────────────────────────────────────────

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PLUGIN_DIR, "data")
SUPPORTED_IMG_EXT = ('.png', '.jpg', '.jpeg', '.webp')


def _ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def _read_image_metadata(img_path: str) -> dict:
    """Read ComfyUI-embedded PNG metadata (prompt / workflow)."""
    if not HAS_PIL:
        return {}
    try:
        with Image.open(img_path) as img:
            info = img.info or {}
            meta = {}
            for key in ("prompt", "workflow"):
                if key in info:
                    try:
                        meta[key] = json.loads(info[key])
                    except Exception:
                        meta[key] = info[key]
            return meta
    except Exception as e:
        print(f"[Universal Extractor] metadata read error ({img_path}): {e}")
        return {}


def _extract_artist_prompts_from_metadata(meta: dict) -> list[str]:
    """
    Try to pull artist-related text out of the ComfyUI workflow metadata.
    Looks for any CLIPTextEncode node text that matches artist patterns.
    """
    results = []
    prompt_data = meta.get("prompt")
    if not prompt_data or not isinstance(prompt_data, dict):
        return results

    for _node_id, node in prompt_data.items():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs", {})
        class_type = node.get("class_type", "")

        # Check our own extractor node
        if class_type == "UniversalTextExtractor":
            # Record which file it drew from
            fname = inputs.get("file_name", "")
            if fname:
                results.append(f"[Extractor: {fname}]")

        # Check any text encode nodes for artist keywords
        if "text" in inputs and isinstance(inputs["text"], str):
            text = inputs["text"]
            # Simple heuristic: if it contains "by " or known artist-wrapping patterns
            if "by " in text.lower() or "artist" in text.lower():
                results.append(text[:200])  # truncate

    return results


# ────────────────────────────────────────────
#  API: Gallery Images
# ────────────────────────────────────────────

async def api_list_images(request: web.Request) -> web.Response:
    """GET /universal_gallery/api/images?page=1&limit=60&search=..."""
    output_dir = folder_paths.get_output_directory()
    if not output_dir or not os.path.exists(output_dir):
        return web.json_response({"images": [], "total": 0})

    search = request.query.get("search", "").lower()
    page = int(request.query.get("page", "1"))
    limit = int(request.query.get("limit", "60"))

    all_files = []
    for f in os.listdir(output_dir):
        if f.lower().endswith(SUPPORTED_IMG_EXT):
            if search and search not in f.lower():
                continue
            full = os.path.join(output_dir, f)
            stat = os.stat(full)
            all_files.append({
                "filename": f,
                "url": f"/view?filename={urllib.parse.quote(f)}&type=output",
                "size": stat.st_size,
                "created_at": stat.st_ctime,
            })

    all_files.sort(key=lambda x: x["created_at"], reverse=True)
    total = len(all_files)
    start = (page - 1) * limit
    paged = all_files[start:start + limit]

    return web.json_response({"images": paged, "total": total, "page": page, "limit": limit})


async def api_image_metadata(request: web.Request) -> web.Response:
    """GET /universal_gallery/api/metadata?filename=xxx.png"""
    filename = request.query.get("filename", "")
    if not filename:
        return web.json_response({"error": "filename required"}, status=400)

    output_dir = folder_paths.get_output_directory()
    full_path = os.path.join(output_dir, filename)
    if not os.path.exists(full_path):
        return web.json_response({"error": "not found"}, status=404)

    meta = _read_image_metadata(full_path)
    artist_prompts = _extract_artist_prompts_from_metadata(meta)

    return web.json_response({
        "filename": filename,
        "metadata": meta,
        "artist_prompts": artist_prompts,
    })


# ────────────────────────────────────────────
#  API: Artist Library Management (CRUD)
# ────────────────────────────────────────────

async def api_list_libraries(request: web.Request) -> web.Response:
    """GET /universal_gallery/api/libraries  — list all JSON files in data/"""
    _ensure_data_dir()
    libs = []
    for f in sorted(os.listdir(DATA_DIR)):
        if f.endswith(".json"):
            full = os.path.join(DATA_DIR, f)
            try:
                with open(full, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                count = len(data) if isinstance(data, list) else 0
            except Exception:
                count = 0
            libs.append({"filename": f, "count": count, "size": os.path.getsize(full)})
    return web.json_response({"libraries": libs})


async def api_get_library(request: web.Request) -> web.Response:
    """GET /universal_gallery/api/library?name=artists.json"""
    name = request.query.get("name", "")
    if not name:
        return web.json_response({"error": "name required"}, status=400)
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        return web.json_response({"error": "not found"}, status=404)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return web.json_response({"name": name, "data": data})


async def api_save_library(request: web.Request) -> web.Response:
    """POST /universal_gallery/api/library  body: {name: "xxx.json", data: [...]}"""
    body = await request.json()
    name = body.get("name", "")
    data = body.get("data")
    if not name or data is None:
        return web.json_response({"error": "name and data required"}, status=400)
    if not name.endswith(".json"):
        name += ".json"
    _ensure_data_dir()
    path = os.path.join(DATA_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return web.json_response({"ok": True, "name": name})


async def api_delete_library(request: web.Request) -> web.Response:
    """DELETE /universal_gallery/api/library?name=xxx.json"""
    name = request.query.get("name", "")
    if not name:
        return web.json_response({"error": "name required"}, status=400)
    path = os.path.join(DATA_DIR, name)
    if os.path.exists(path):
        os.remove(path)
    return web.json_response({"ok": True})


# ────────────────────────────────────────────
#  Route Registration
# ────────────────────────────────────────────

def setup_routes():
    if not (hasattr(server, "PromptServer") 
            and getattr(server.PromptServer, "instance", None) 
            and hasattr(server.PromptServer.instance, "app")):
        print("[Universal Extractor] PromptServer not ready, skipping route setup.")
        return

    app = server.PromptServer.instance.app

    # Gallery APIs
    app.router.add_get("/universal_gallery/api/images", api_list_images)
    app.router.add_get("/universal_gallery/api/metadata", api_image_metadata)

    # Library CRUD APIs
    app.router.add_get("/universal_gallery/api/libraries", api_list_libraries)
    app.router.add_get("/universal_gallery/api/library", api_get_library)
    app.router.add_post("/universal_gallery/api/library", api_save_library)
    app.router.add_delete("/universal_gallery/api/library", api_delete_library)

    # Serve gallery UI static files
    ui_dir = os.path.join(PLUGIN_DIR, "gallery_ui", "dist")
    if os.path.exists(ui_dir):
        app.router.add_static("/gallery", ui_dir, show_index=True)
        print("[Universal Extractor] Gallery UI -> /gallery")
    else:
        print(f"[Universal Extractor] Warning: {ui_dir} not found. Run 'npm run build' in gallery_ui/")


setup_routes()
