import os
import json
import time
from aiohttp import web

try:
    import server
    import folder_paths
except ImportError:
    # Fallback for testing outside ComfyUI
    class DummyServer:
        class instance:
            app = None
    server = DummyServer()
    class DummyPaths:
        def get_output_directory(self):
            return ""
    folder_paths = DummyPaths()

from PIL import Image

def get_image_metadata(img_path):
    try:
        with Image.open(img_path) as img:
            info = img.info
            metadata = {}
            if "prompt" in info:
                try:
                    metadata["prompt"] = json.loads(info["prompt"])
                except Exception:
                    metadata["prompt"] = info["prompt"]
            if "workflow" in info:
                try:
                    metadata["workflow"] = json.loads(info["workflow"])
                except Exception:
                    metadata["workflow"] = info["workflow"]
            return metadata
    except Exception as e:
        print(f"[Universal Extractor] Error reading metadata for {img_path}: {e}")
        return {}

def build_images_api():
    async def api_images(request):
        output_dir = folder_paths.get_output_directory()
        if not output_dir or not os.path.exists(output_dir):
            return web.json_response({"error": "Output directory not found", "images": []})
            
        images = []
        for file in os.listdir(output_dir):
            if file.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                full_path = os.path.join(output_dir, file)
                stat = os.stat(full_path)
                # metadata = get_image_metadata(full_path) # We can skip full metadata parsing here for speed, or parse it lazily
                
                images.append({
                    "filename": file,
                    "url": f"/view?filename={file}&type=output", # ComfyUI built-in route
                    "size": stat.st_size,
                    "created_at": stat.st_ctime
                })
        
        # Sort by creation time desc
        images.sort(key=lambda x: x["created_at"], reverse=True)
        return web.json_response({"images": images})

    return api_images

def build_image_metadata_api():
    async def api_image_metadata(request):
        filename = request.query.get("filename")
        if not filename:
            return web.json_response({"error": "No filename provided"})
            
        output_dir = folder_paths.get_output_directory()
        full_path = os.path.join(output_dir, filename)
        if not os.path.exists(full_path):
            return web.json_response({"error": "File not found"})
            
        metadata = get_image_metadata(full_path)
        return web.json_response({"metadata": metadata})
        
    return api_image_metadata


def setup_routes():
    if getattr(server.PromptServer, "instance", None) and hasattr(server.PromptServer.instance, "app"):
        app = server.PromptServer.instance.app
        
        # API Routes
        app.router.add_get("/universal_gallery/api/images", build_images_api())
        app.router.add_get("/universal_gallery/api/metadata", build_image_metadata_api())
        
        # Serve UI static files
        current_dir = os.path.dirname(os.path.abspath(__file__))
        ui_dir = os.path.join(os.path.dirname(current_dir), "gallery_ui", "dist")
        
        if os.path.exists(ui_dir):
            app.router.add_static("/gallery", ui_dir, show_index=True)
            print(f"[Universal Extractor] Gallery UI registered at /gallery")
        else:
            print(f"[Universal Extractor] Warning: Gallery UI dir {ui_dir} not found. Please build the UI.")
            # For testing:
            pass

setup_routes()
