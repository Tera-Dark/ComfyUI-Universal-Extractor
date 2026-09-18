"""Optional pass-through capturing resolved prompt text, including cached inputs."""
from __future__ import annotations


class UniversalPromptSnapshot:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"forceInput": True}),
                "role": (["positive", "negative", "notes"],),
            },
            "hidden": {"extra_pnginfo": "EXTRA_PNGINFO", "unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "capture"
    CATEGORY = "Universal Tools"
    DESCRIPTION = "Pass resolved text through to CLIP; store it in PNG metadata without re-running upstream randomizers."

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # EXTRA_PNGINFO is per execution; cached upstream STRINGs remain valid.
        return float("nan")

    def capture(self, text, role="positive", extra_pnginfo=None, unique_id=""):
        if isinstance(extra_pnginfo, dict):
            snapshots = extra_pnginfo.setdefault("universal_prompt_snapshots", {})
            if isinstance(snapshots, dict):
                snapshots[str(unique_id)] = {"text": text, "role": role, "node_id": str(unique_id), "version": 1}
        return (text,)
