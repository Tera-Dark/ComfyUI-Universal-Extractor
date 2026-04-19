import importlib
import os
import sys


PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PLUGIN_DIR not in sys.path:
    sys.path.insert(0, PLUGIN_DIR)


def load_node_class():
    module = importlib.import_module(".nodes.extractor_node", package=__package__)
    return module.UniversalTextExtractor


def register_gallery_routes():
    try:
        import server as comfy_server
    except ImportError:
        print("[Universal Extractor] ComfyUI server module not available, skipping route setup.")
        return

    prompt_server = getattr(comfy_server, "PromptServer", None)
    if not prompt_server or not getattr(prompt_server, "instance", None) or not hasattr(prompt_server.instance, "app"):
        print("[Universal Extractor] PromptServer not ready, skipping route setup.")
        return

    from .gallery.routes import register_routes

    register_routes(prompt_server.instance.app)
