"""Isolated Gallery preview. NOT a ComfyUI inference server.

python scripts/preview.py --port 8189
Creates demo images/state in a temporary directory, never in real ComfyUI paths.
Bind to localhost outside a sandbox; --host 0.0.0.0 is only for controlled preview.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import random
import sys
import tempfile
import time
import types

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--host", default="127.0.0.1")
parser.add_argument("--port", type=int, default=8189)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
temporary = tempfile.TemporaryDirectory(prefix="universal-preview-")
base = Path(temporary.name)
for name in ("output", "input", "data"):
    (base / name).mkdir()
os.environ["UNIVERSAL_EXTRACTOR_DATA_DIR"] = str(base / "data")
folder_paths = types.ModuleType("folder_paths")
folder_paths.base_path = str(base)
folder_paths.get_output_directory = lambda: str(base / "output")
folder_paths.get_input_directory = lambda: str(base / "input")
sys.modules["folder_paths"] = folder_paths

from PIL import Image, ImageDraw, PngImagePlugin
from aiohttp import web
from py.gallery import routes

palettes = [
    ("#efe9df", "#c3c6b3", "#677c68", "#ddd2b7"),
    ("#e9ddd3", "#dba890", "#ad705b", "#f2cfc0"),
    ("#dce4e7", "#b0c5c8", "#556f7c", "#d4d6c0"),
    ("#efe8d8", "#d7c09b", "#958267", "#e0c697"),
]
folders = ["01 · Landscapes", "02 · Color studies", "03 · Architecture"]
for folder in folders:
    (base / "output" / folder).mkdir()
for index in range(18):
    width, height = [(600, 760), (600, 600), (600, 460)][index % 3]
    colors = palettes[index % len(palettes)]
    image = Image.new("RGB", (width, height), colors[0])
    draw = ImageDraw.Draw(image)
    rng = random.Random(index)
    if index % 3 == 0:
        draw.ellipse((360, 100, 460, 200), fill=colors[3])
        for layer in range(3):
            y = height * (.44 + .17 * layer)
            points = [(0, height), (0, y)] + [(x, y + rng.randrange(-65, 65)) for x in range(0, 660, 60)] + [(width, height)]
            draw.polygon(points, fill=colors[(layer + 1) % 4])
    elif index % 3 == 1:
        for ring in range(8, 0, -1):
            radius = ring * 32
            draw.ellipse((300-radius, 300-radius, 300+radius, 300+radius), fill=colors[ring % 4])
    else:
        draw.rectangle((120, 110, 480, 460), fill=colors[1])
        draw.rounded_rectangle((215, 160, 385, 500), radius=85, fill=colors[2])
        draw.rectangle((0, 370, 600, 460), fill=colors[3])
        draw.polygon([(390, 280), (600, 390), (600, 460), (390, 460)], fill=colors[2])
    prompt = f"Demo study {index+1}, minimal composition, soft daylight"
    graph = {"1": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt}},
             "2": {"class_type": "KSampler", "inputs": {"steps": 24, "cfg": 6, "seed": index, "positive": ["1", 0]}}}
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("prompt", json.dumps(graph))
    image.save(base / "output" / folders[index % 3] / f"Study_{index+1:03}.png", pnginfo=metadata)
(base / "data" / "Demo prompts.json").write_text(json.dumps([
    {"name": "Soft daylight", "tags": ["natural light", "minimal composition"]},
    {"name": "Quiet landscapes", "tags": ["landscape", "muted colors"]},
], ensure_ascii=False))

async def preview_updates(force=False):
    return {"current_version": "1.4.0", "latest_version": "1.4.0", "update_available": False,
            "published_at": None, "release_notes": "", "has_remote_check": False,
            "checked_at": int(time.time()), "error": None, "repository_url": "https://github.com/Tera-Dark/ComfyUI-Universal-Extractor", "release_url": ""}
routes.check_update_status = preview_updates
app = web.Application()
routes.register_routes(app)
# ComfyUI normally provides /view. The isolated fixture supplies it only for its own samples.
async def preview_image(request):
    kind = request.query.get("type", "output")
    if kind not in ("input", "output"):
        raise web.HTTPNotFound()
    image_root = (base / kind).resolve()
    image_path = (image_root / request.query.get("subfolder", "") / request.query.get("filename", "")).resolve()
    if not image_path.is_relative_to(image_root) or not image_path.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(image_path)
app.router.add_get("/view", preview_image)
async def home(request):
    raise web.HTTPFound("/gallery/")
app.router.add_get("/", home)
print("ISOLATED DEMO: procedural sample images, no ComfyUI/GPU inference; state is temporary.")
web.run_app(app, host=args.host, port=args.port)
