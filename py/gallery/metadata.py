from __future__ import annotations

from typing import Any

try:
    from PIL import Image

    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("[Universal Extractor] Warning: Pillow not found, metadata extraction disabled.")


def read_image_metadata(image_path: str) -> dict:
    if not HAS_PIL:
        return {}

    try:
        import json

        with Image.open(image_path) as image:
            info = image.info or {}
            metadata = {}
            for key in ("prompt", "workflow"):
                if key in info:
                    try:
                        metadata[key] = json.loads(info[key])
                    except Exception:
                        metadata[key] = info[key]
            return metadata
    except Exception as error:
        print(f"[Universal Extractor] metadata read error ({image_path}): {error}")
        return {}


def extract_artist_prompts(metadata: dict) -> list[str]:
    prompt_data = metadata.get("prompt")
    if not isinstance(prompt_data, dict):
        return []

    results: list[str] = []
    for node in prompt_data.values():
        if not isinstance(node, dict):
            continue

        inputs = node.get("inputs", {})
        if node.get("class_type") == "UniversalTextExtractor":
            file_name = inputs.get("file_name")
            if file_name:
                results.append(f"[Extractor: {file_name}]")

        text = inputs.get("text")
        if isinstance(text, str) and ("by " in text.lower() or "artist" in text.lower()):
            results.append(text[:300])

    deduped: list[str] = []
    seen = set()
    for item in results:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    return deduped


def _resolve_reference_node(prompt_data: dict, reference_value) -> dict[str, Any] | None:
    if isinstance(reference_value, (list, tuple)) and reference_value:
        node = prompt_data.get(str(reference_value[0]))
        if isinstance(node, dict):
            return node
    return None


def build_prompt_summary(metadata: dict) -> dict:
    summary = {
        "positive_prompt": "",
        "negative_prompt": "",
        "size": "",
        "seed": None,
        "steps": None,
        "sampler": "",
        "cfg": None,
        "scheduler": "",
        "denoise": None,
    }

    prompt_data = metadata.get("prompt")
    if not isinstance(prompt_data, dict):
        return summary

    sampler_node = None
    for node in prompt_data.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs", {})
        if "steps" in inputs and ("sampler_name" in inputs or "sampler" in inputs):
            sampler_node = node
            break

    if sampler_node:
        inputs = sampler_node.get("inputs", {})
        summary["seed"] = inputs.get("seed", inputs.get("noise_seed"))
        summary["steps"] = inputs.get("steps")
        summary["cfg"] = inputs.get("cfg")
        summary["sampler"] = inputs.get("sampler_name", inputs.get("sampler", ""))
        summary["scheduler"] = inputs.get("scheduler", "")
        summary["denoise"] = inputs.get("denoise")

        positive_node = _resolve_reference_node(prompt_data, inputs.get("positive"))
        negative_node = _resolve_reference_node(prompt_data, inputs.get("negative"))
        latent_node = _resolve_reference_node(prompt_data, inputs.get("latent_image"))

        positive_text = positive_node.get("inputs", {}).get("text") if positive_node else None
        negative_text = negative_node.get("inputs", {}).get("text") if negative_node else None
        if isinstance(positive_text, str):
            summary["positive_prompt"] = positive_text
        if isinstance(negative_text, str):
            summary["negative_prompt"] = negative_text

        if latent_node:
            latent_inputs = latent_node.get("inputs", {})
            width = latent_inputs.get("width")
            height = latent_inputs.get("height")
            if width and height:
                summary["size"] = f"{width}x{height}"

    if not summary["size"]:
        for node in prompt_data.values():
            if not isinstance(node, dict):
                continue
            inputs = node.get("inputs", {})
            width = inputs.get("width")
            height = inputs.get("height")
            if width and height:
                summary["size"] = f"{width}x{height}"
                break

    return summary
