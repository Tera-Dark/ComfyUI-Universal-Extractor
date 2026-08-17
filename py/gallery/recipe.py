from __future__ import annotations

import re
from typing import Any


LORA_SYNTAX_RE = re.compile(r"<lora:([^:>]+):([^:>]+)(?::([^:>]+))?>", re.IGNORECASE)


def _prompt_data(metadata: dict) -> dict[str, Any]:
    prompt = metadata.get("prompt")
    return prompt if isinstance(prompt, dict) else {}


def _node_inputs(node: Any) -> dict[str, Any]:
    if not isinstance(node, dict):
        return {}
    inputs = node.get("inputs")
    return inputs if isinstance(inputs, dict) else {}


def _class_type(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    value = node.get("class_type")
    return value if isinstance(value, str) else ""


def _string_input(inputs: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = inputs.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _recipe_scalar(value: Any) -> str | int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (str, int, float)):
        return value
    return None


def _recipe_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _resolve_reference_node(prompt_data: dict[str, Any], reference_value: Any) -> dict[str, Any] | None:
    if isinstance(reference_value, (list, tuple)) and reference_value:
        node = prompt_data.get(str(reference_value[0]))
        if isinstance(node, dict):
            return node
    return None


def _size_from_prompt(prompt_data: dict[str, Any], sampler_inputs: dict[str, Any] | None = None) -> tuple[str, Any, Any]:
    latent_node = _resolve_reference_node(prompt_data, sampler_inputs.get("latent_image")) if sampler_inputs else None
    candidates = [latent_node] if latent_node else []
    candidates.extend(node for node in prompt_data.values() if isinstance(node, dict))

    for node in candidates:
        inputs = _node_inputs(node)
        width = inputs.get("width")
        height = inputs.get("height")
        if width and height:
            return f"{width}x{height}", width, height

    return "", None, None


def _find_sampler_node(prompt_data: dict[str, Any]) -> dict[str, Any] | None:
    for node in prompt_data.values():
        inputs = _node_inputs(node)
        if "steps" in inputs and ("sampler_name" in inputs or "sampler" in inputs or "cfg" in inputs):
            return node if isinstance(node, dict) else None
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

    prompt_data = _prompt_data(metadata)
    if not prompt_data:
        return summary

    sampler_node = _find_sampler_node(prompt_data)
    sampler_inputs = _node_inputs(sampler_node)
    if sampler_node:
        summary["seed"] = sampler_inputs.get("seed", sampler_inputs.get("noise_seed"))
        summary["steps"] = sampler_inputs.get("steps")
        summary["cfg"] = sampler_inputs.get("cfg")
        summary["sampler"] = sampler_inputs.get("sampler_name", sampler_inputs.get("sampler", ""))
        summary["scheduler"] = sampler_inputs.get("scheduler", "")
        summary["denoise"] = sampler_inputs.get("denoise")

        positive_node = _resolve_reference_node(prompt_data, sampler_inputs.get("positive"))
        negative_node = _resolve_reference_node(prompt_data, sampler_inputs.get("negative"))

        positive_text = _node_inputs(positive_node).get("text") if positive_node else None
        negative_text = _node_inputs(negative_node).get("text") if negative_node else None
        if isinstance(positive_text, str):
            summary["positive_prompt"] = positive_text
        if isinstance(negative_text, str):
            summary["negative_prompt"] = negative_text

    size, _, _ = _size_from_prompt(prompt_data, sampler_inputs)
    summary["size"] = size
    return summary


def extract_artist_prompts(metadata: dict) -> list[str]:
    prompt_data = _prompt_data(metadata)
    if not prompt_data:
        return []

    results: list[str] = []
    for node in prompt_data.values():
        inputs = _node_inputs(node)
        if _class_type(node) in {"UniversalTextExtractor", "UniversalJsonSegmentRandomizer"}:
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


def _extract_checkpoint(prompt_data: dict[str, Any]) -> str:
    for node in prompt_data.values():
        inputs = _node_inputs(node)
        class_type = _class_type(node).lower()
        if "checkpoint" in class_type or "ckpt" in class_type:
            checkpoint = _string_input(inputs, "ckpt_name", "checkpoint_name", "model_name")
            if checkpoint:
                return checkpoint
    return ""


def _extract_loras(prompt_data: dict[str, Any]) -> list[dict[str, Any]]:
    loras: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for node in prompt_data.values():
        inputs = _node_inputs(node)
        class_type = _class_type(node).lower()
        if "lora" not in class_type and "lora_name" not in inputs:
            continue

        name = _string_input(inputs, "lora_name", "lora", "name")
        if not name:
            continue

        strength_model = _recipe_scalar(inputs.get("strength_model", inputs.get("strength", None)))
        strength_clip = _recipe_scalar(inputs.get("strength_clip", None))
        fingerprint = (name, str(strength_model), str(strength_clip))
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        loras.append(
            {
                "name": name,
                "strength_model": strength_model,
                "strength_clip": strength_clip,
            }
        )
    return loras


def _node_label(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    parts = []
    for key in ("class_type", "type", "title", "name"):
        value = node.get(key)
        if isinstance(value, str):
            parts.append(value)
    return " ".join(parts)


def _looks_like_lora_manager_node(node: Any) -> bool:
    label = _node_label(node).lower()
    if "loramanager" in label or "lora manager" in label:
        return True
    if "lora" in label and ("\u5806" in label or "\u936b" in label):
        return True
    if "lora stacker" in label or "lora stack combiner" in label:
        return True
    if "lora loader" in label and "manager" in label:
        return True
    return False


def _format_lora_syntax(loras: list[dict[str, Any]]) -> str:
    tokens: list[str] = []
    for item in loras:
        name = item.get("name")
        if not isinstance(name, str) or not name:
            continue
        strength_model = item.get("strength_model")
        strength_clip = item.get("strength_clip")
        model_text = str(strength_model if strength_model is not None else 1.0)
        if strength_clip is not None and str(strength_clip) != model_text:
            tokens.append(f"<lora:{name}:{model_text}:{strength_clip}>")
        else:
            tokens.append(f"<lora:{name}:{model_text}>")
    return " ".join(tokens)


def _dedupe_lora_manager_loras(loras: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, bool]] = set()
    for item in loras:
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        normalized = {
            "name": name.strip(),
            "strength_model": item.get("strength_model"),
            "strength_clip": item.get("strength_clip"),
            "enabled": item.get("enabled") is not False,
        }
        fingerprint = (
            normalized["name"],
            str(normalized["strength_model"]),
            str(normalized["strength_clip"]),
            bool(normalized["enabled"]),
        )
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        deduped.append(normalized)
    return deduped


def _parse_lora_syntax(text: str) -> list[dict[str, Any]]:
    loras: list[dict[str, Any]] = []
    for match in LORA_SYNTAX_RE.findall(text):
        model_strength = _recipe_float(match[1])
        clip_strength = _recipe_float(match[2]) if match[2] else model_strength
        loras.append(
            {
                "name": match[0].strip(),
                "strength_model": model_strength if model_strength is not None else match[1].strip(),
                "strength_clip": clip_strength if clip_strength is not None else (match[2].strip() if match[2] else model_strength),
                "enabled": True,
            }
        )
    return loras


def _parse_loras_widget(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict) and isinstance(value.get("__value__"), list):
        value = value["__value__"]
    if not isinstance(value, list):
        return []

    loras: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        if item.get("active") is False or item.get("enabled") is False:
            continue
        name = item.get("name") or item.get("lora_name") or item.get("lora")
        if not isinstance(name, str) or not name.strip():
            continue
        model_strength = _recipe_scalar(item.get("strength", item.get("strength_model", item.get("model_strength"))))
        clip_strength = _recipe_scalar(item.get("clipStrength", item.get("strength_clip", item.get("clip_strength", model_strength))))
        loras.append(
            {
                "name": name.strip(),
                "strength_model": model_strength,
                "strength_clip": clip_strength,
                "enabled": True,
            }
        )
    return loras


def _parse_lora_stack_value(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    loras: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        name = item[0]
        if not isinstance(name, str) or not name.strip():
            continue
        loras.append(
            {
                "name": name.strip().replace("\\", "/").rsplit("/", 1)[-1].rsplit(".", 1)[0],
                "strength_model": _recipe_scalar(item[1]),
                "strength_clip": _recipe_scalar(item[2] if len(item) > 2 else item[1]),
                "enabled": True,
            }
        )
    return loras


LORA_MANAGER_STACK_KEYS = {"lora_stack", "lora_stack_data", "active_loras", "loaded_loras"}


def _collect_lora_manager_values(
    value: Any,
    *,
    allow_stack_list: bool = False,
    parse_text_loras: bool = True,
) -> tuple[list[dict[str, Any]], list[str]]:
    loras: list[dict[str, Any]] = []
    raw_texts: list[str] = []

    if isinstance(value, str):
        if "<lora:" in value.lower():
            raw_texts.append(value.strip())
            if parse_text_loras:
                loras.extend(_parse_lora_syntax(value))
        return loras, raw_texts

    loras.extend(_parse_loras_widget(value))
    if allow_stack_list:
        loras.extend(_parse_lora_stack_value(value))

    if isinstance(value, dict):
        for key, child in value.items():
            child_loras, child_texts = _collect_lora_manager_values(
                child,
                allow_stack_list=str(key).lower() in LORA_MANAGER_STACK_KEYS,
                parse_text_loras=parse_text_loras,
            )
            loras.extend(child_loras)
            raw_texts.extend(child_texts)
    elif isinstance(value, list):
        for child in value:
            child_loras, child_texts = _collect_lora_manager_values(child, parse_text_loras=parse_text_loras)
            loras.extend(child_loras)
            raw_texts.extend(child_texts)

    return loras, raw_texts


LORA_MANAGER_STRUCTURED_KEYS = {"loras", "lora_stack_data", "active_loras", "loaded_loras"}
LORA_MANAGER_TEXT_KEYS = {"text", "lora_syntax", "lora_text"}


def _collect_lora_manager_named_values(named_values: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    structured_loras: list[dict[str, Any]] = []
    fallback_loras: list[dict[str, Any]] = []
    raw_texts: list[str] = []
    has_structured_source = False

    for key, value in named_values.items():
        normalized_key = str(key).lower()
        if normalized_key in LORA_MANAGER_STRUCTURED_KEYS:
            has_structured_source = True
            node_loras, node_raw_texts = _collect_lora_manager_values(
                value,
                allow_stack_list=normalized_key in LORA_MANAGER_STACK_KEYS,
                parse_text_loras=False,
            )
            structured_loras.extend(node_loras)
            raw_texts.extend(node_raw_texts)
            continue
        if normalized_key in LORA_MANAGER_TEXT_KEYS or normalized_key in LORA_MANAGER_STACK_KEYS:
            node_loras, node_raw_texts = _collect_lora_manager_values(
                value,
                allow_stack_list=normalized_key in LORA_MANAGER_STACK_KEYS,
                parse_text_loras=True,
            )
            fallback_loras.extend(node_loras)
            raw_texts.extend(node_raw_texts)

    return (structured_loras if has_structured_source else fallback_loras), raw_texts


def _workflow_widget_named_values(node: dict[str, Any]) -> dict[str, Any]:
    properties = node.get("properties")
    widget_ids = properties.get("__lm_widget_ids") if isinstance(properties, dict) else None
    widget_values = node.get("widgets_values")
    if not isinstance(widget_ids, list) or not isinstance(widget_values, list):
        return {}

    named_values: dict[str, Any] = {}
    for index, key in enumerate(widget_ids):
        if not isinstance(key, str) or index >= len(widget_values):
            continue
        named_values[key] = widget_values[index]
    return named_values


def _workflow_nodes(metadata: dict) -> list[dict[str, Any]]:
    workflow = metadata.get("workflow")
    if not isinstance(workflow, dict):
        return []
    nodes = workflow.get("nodes")
    if not isinstance(nodes, list):
        return []
    return [node for node in nodes if isinstance(node, dict)]


def _extract_lora_manager_stack(metadata: dict, prompt_data: dict[str, Any]) -> dict[str, Any]:
    detected = False
    loras: list[dict[str, Any]] = []
    raw_texts: list[str] = []

    for node in prompt_data.values():
        if not _looks_like_lora_manager_node(node):
            continue
        detected = True
        inputs = _node_inputs(node)
        node_loras, node_raw_texts = _collect_lora_manager_named_values(inputs)
        loras.extend(node_loras)
        raw_texts.extend(node_raw_texts)

    for node in _workflow_nodes(metadata):
        if not _looks_like_lora_manager_node(node):
            continue
        detected = True
        named_values = _workflow_widget_named_values(node)
        if named_values:
            node_loras, node_raw_texts = _collect_lora_manager_named_values(named_values)
        else:
            node_loras, node_raw_texts = _collect_lora_manager_values(node.get("widgets_values"))
        loras.extend(node_loras)
        raw_texts.extend(node_raw_texts)

    deduped = _dedupe_lora_manager_loras(loras)
    raw_stack = _format_lora_syntax(deduped) or " ".join(text for text in raw_texts if text).strip()
    return {
        "detected": detected,
        "raw_stack": raw_stack,
        "loras": deduped,
    }


def extract_generation_recipe(metadata: dict) -> dict:
    prompt_data = _prompt_data(metadata)
    summary = build_prompt_summary(metadata)
    sampler_node = _find_sampler_node(prompt_data)
    sampler_inputs = _node_inputs(sampler_node)
    _, width, height = _size_from_prompt(prompt_data, sampler_inputs)

    return {
        "source_format": "comfy_prompt" if prompt_data else "unknown",
        "has_workflow": isinstance(metadata.get("workflow"), dict),
        "positive_prompt": summary["positive_prompt"],
        "negative_prompt": summary["negative_prompt"],
        "checkpoint": _extract_checkpoint(prompt_data),
        "loras": _extract_loras(prompt_data),
        "width": _recipe_scalar(width),
        "height": _recipe_scalar(height),
        "seed": _recipe_scalar(summary["seed"]),
        "steps": _recipe_scalar(summary["steps"]),
        "cfg": _recipe_scalar(summary["cfg"]),
        "sampler": summary["sampler"],
        "scheduler": summary["scheduler"],
        "denoise": _recipe_scalar(summary["denoise"]),
        "lora_manager": _extract_lora_manager_stack(metadata, prompt_data),
    }
