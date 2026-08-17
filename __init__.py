try:
    from .py.plugin import load_node_classes, register_gallery_routes
except ImportError:
    from py.plugin import load_node_classes, register_gallery_routes


_NODE_CLASSES = load_node_classes()
UniversalJsonSegmentRandomizer = _NODE_CLASSES["UniversalJsonSegmentRandomizer"]
register_gallery_routes()


NODE_CLASS_MAPPINGS = {
    "UniversalJsonSegmentRandomizer": UniversalJsonSegmentRandomizer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "UniversalJsonSegmentRandomizer": "Universal Artist/Tag Randomizer",
}

WEB_DIRECTORY = "./web/comfyui"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
