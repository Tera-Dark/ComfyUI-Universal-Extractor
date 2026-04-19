from .py.plugin import load_node_class, register_gallery_routes


UniversalTextExtractor = load_node_class()
register_gallery_routes()


NODE_CLASS_MAPPINGS = {
    "UniversalTextExtractor": UniversalTextExtractor,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "UniversalTextExtractor": "Universal Extractor",
}

WEB_DIRECTORY = "./web/comfyui"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
