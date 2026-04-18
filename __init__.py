import os
import sys
import importlib

# Ensure our plugin directory is in sys.path
_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
if _PLUGIN_DIR not in sys.path:
    sys.path.insert(0, _PLUGIN_DIR)

# Use importlib to safely load our submodules, avoiding name conflicts with ComfyUI's own 'server' module
_nodes_mod = importlib.import_module(".nodes.extractor_node", package=__name__)
UniversalTextExtractor = _nodes_mod.UniversalTextExtractor

# Load API routes (registers endpoints on ComfyUI's PromptServer)
try:
    importlib.import_module(".api.gallery_api", package=__name__)
except Exception as e:
    print(f"[Universal Extractor] Warning: Failed to load gallery API routes: {e}")

# A dictionary that contains all nodes you want to export with their names
# NOTE: names should be globally unique
NODE_CLASS_MAPPINGS = {
    "UniversalTextExtractor": UniversalTextExtractor
}

# A dictionary that contains the friendly/humanly readable titles for the nodes
NODE_DISPLAY_NAME_MAPPINGS = {
    "UniversalTextExtractor": "🌟 Universal Extractor (万能抽签)"
}

# Web directory for UI extensions - ComfyUI loads all .js files from here
WEB_DIRECTORY = "./web/comfyui"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
