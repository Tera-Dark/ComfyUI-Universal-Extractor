import os
import sys

# Add the current directory to sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from nodes.extractor_node import UniversalTextExtractor
import server.gallery_api  # This will register the API routes

# A dictionary that contains all nodes you want to export with their names
# NOTE: names should be globally unique
NODE_CLASS_MAPPINGS = {
    "UniversalTextExtractor": UniversalTextExtractor
}

# A dictionary that contains the friendly/humanly readable titles for the nodes
NODE_DISPLAY_NAME_MAPPINGS = {
    "UniversalTextExtractor": "🌟 Universal Extractor (万能抽签)"
}

# Web directory for UI extensions (if we need to add a menu button later)
WEB_DIRECTORY = "./web/comfyui"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
