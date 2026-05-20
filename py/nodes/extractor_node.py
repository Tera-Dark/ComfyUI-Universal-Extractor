import hashlib
import json
import os
import random
from typing import Any

from ..constants import DATA_DIR, RUNTIME_STATE_FILENAMES

POLLING_STATE: dict[str, int] = {}


def list_json_files():
    os.makedirs(DATA_DIR, exist_ok=True)
    files = sorted(
        filename
        for filename in os.listdir(DATA_DIR)
        if filename.endswith(".json") and filename not in RUNTIME_STATE_FILENAMES
    )
    return files if files else ["None"]


def resolve_library_path(file_name: str):
    raw_name = file_name or ""
    clean_name = os.path.basename(raw_name)
    if raw_name != clean_name:
        return None
    if clean_name == "None" or not clean_name.endswith(".json") or clean_name in RUNTIME_STATE_FILENAMES:
        return None

    data_dir = os.path.abspath(DATA_DIR)
    file_path = os.path.abspath(os.path.join(data_dir, clean_name))
    if os.path.commonpath([data_dir, file_path]) != data_dir:
        return None
    return file_path


def load_library_json(file_name: str):
    file_path = resolve_library_path(file_name)
    if not file_path:
        return None

    if not os.path.exists(file_path):
        return None

    try:
        with open(file_path, "r", encoding="utf-8") as file:
            return json.load(file)
    except Exception as error:
        print(f"[Universal Extractor] Error loading json: {error}")
        return None


def load_entries(file_name: str):
    data = load_library_json(file_name)
    if not isinstance(data, list):
        return []

    items = []
    for value in data:
        item = coerce_entry_text(value)
        if item:
            items.append(item)

    return items


def coerce_entry_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("prompt", "name", "title"):
            item = value.get(key)
            if isinstance(item, str) and item.strip():
                return item.strip()
    if isinstance(value, list) and value and isinstance(value[0], str):
        return value[0].strip()
    return ""


def parse_field_paths(field_paths: str) -> list[str]:
    paths: list[str] = []
    for chunk in field_paths.replace("\n", ",").replace(";", ",").split(","):
        path = chunk.strip()
        if path:
            paths.append(path)
    return paths


def resolve_json_path(value: Any, path: str) -> list[Any]:
    current_values = [value]
    if not path:
        return current_values

    for raw_token in path.split("."):
        token = raw_token.strip()
        if not token:
            continue

        next_values: list[Any] = []
        for current in current_values:
            if token == "*":
                if isinstance(current, dict):
                    next_values.extend(current.values())
                elif isinstance(current, list):
                    next_values.extend(current)
                continue

            if isinstance(current, dict) and token in current:
                next_values.append(current[token])
                continue

            if isinstance(current, list):
                if token.isdigit():
                    index = int(token)
                    if 0 <= index < len(current):
                        next_values.append(current[index])
                else:
                    for item in current:
                        if isinstance(item, dict) and token in item:
                            next_values.append(item[token])
        current_values = next_values
        if not current_values:
            break

    return current_values


def collect_segment_values(value: Any) -> list[str]:
    if isinstance(value, str):
        clean_value = value.strip()
        return [clean_value] if clean_value else []
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return [str(value)]
    if isinstance(value, list):
        results: list[str] = []
        for item in value:
            results.extend(collect_segment_values(item))
        return results
    if isinstance(value, dict):
        results = []
        for item in value.values():
            results.extend(collect_segment_values(item))
        return results
    return []


def entry_matches_filter(entry: Any, filter_path: str, filter_value: str, filter_mode: str) -> bool:
    if not filter_path.strip():
        return True

    values: list[str] = []
    for resolved in resolve_json_path(entry, filter_path):
        values.extend(collect_segment_values(resolved))

    if filter_mode == "not_empty":
        return bool(values)

    needle = filter_value.strip().lower()
    if not needle:
        return bool(values)

    if filter_mode == "equals":
        return any(value.lower() == needle for value in values)
    return any(needle in value.lower() for value in values)


def load_segments(file_name: str, field_paths: str, filter_path: str = "", filter_value: str = "", filter_mode: str = "contains"):
    data = load_library_json(file_name)
    if data is None:
        return []

    paths = parse_field_paths(field_paths)
    if not paths:
        paths = ["prompt", "name", "title"]

    entries = data if isinstance(data, list) else [data]
    items: list[str] = []
    for entry in entries:
        if not entry_matches_filter(entry, filter_path, filter_value, filter_mode):
            continue
        for path in paths:
            resolved_values = resolve_json_path(entry, path)
            if not resolved_values and isinstance(entry, (str, int, float)) and not isinstance(entry, bool):
                resolved_values = [entry]
            for resolved in resolved_values:
                items.extend(collect_segment_values(resolved))
    return items


def select_items(
    items: list[str],
    extract_count: int,
    mode: str,
    seed: int,
    duplicate_policy: str,
    polling_key: str = "",
):
    if not items:
        return []

    if mode == "random":
        randomizer = random.Random(seed)
        if duplicate_policy == "allow_duplicates":
            return [randomizer.choice(items) for _ in range(extract_count)]
        if duplicate_policy == "unique_only":
            return randomizer.sample(items, min(extract_count, len(items)))
        if extract_count > len(items):
            return [randomizer.choice(items) for _ in range(extract_count)]
        return randomizer.sample(items, extract_count)

    if mode == "polling":
        key = polling_key or f"default:{len(items)}:{seed}"
        if key not in POLLING_STATE:
            POLLING_STATE[key] = seed % len(items)
        start_index = POLLING_STATE[key] % len(items)
        POLLING_STATE[key] = (start_index + extract_count) % len(items)
    else:
        start_index = seed % len(items)

    if duplicate_policy == "unique_only":
        count = min(extract_count, len(items))
        return [items[(start_index + index) % len(items)] for index in range(count)]
    return [items[(start_index + index) % len(items)] for index in range(extract_count)]


def strip_outer_wrappers(value: str) -> str:
    current = value.strip()
    changed = True
    pairs = (("(", ")"), ("{", "}"), ("[", "]"))
    while changed and len(current) >= 2:
        changed = False
        for left, right in pairs:
            if current.startswith(left) and current.endswith(right):
                current = current[1:-1].strip()
                changed = True
    return current


def clean_artist_tag(tag: str) -> str:
    cleaned = (
        strip_outer_wrappers(tag)
        .replace("_", " ")
        .replace("\\(", "(")
        .replace("\\)", ")")
        .strip()
    )
    lowered = cleaned.lower()
    if lowered.startswith("artist:"):
        cleaned = cleaned[7:].strip()
    elif lowered.startswith("by "):
        cleaned = cleaned[3:].strip()
    return cleaned


def normalize_artist_words(value: str) -> str:
    return " ".join(value.replace("_", " ").split())


def normalize_anima_tag(tag: str) -> str:
    trimmed = clean_artist_tag(tag).lstrip("@").strip()

    bracket_match = None
    for separator in ("_(", "("):
        if separator in trimmed and trimmed.endswith(")"):
            outer, inner = trimmed.split(separator, 1)
            if inner.endswith(")"):
                bracket_match = (outer.rstrip("_ ").strip(), inner[:-1].strip())
                break

    if bracket_match:
        outer = normalize_artist_words(bracket_match[0])
        inner = normalize_artist_words(bracket_match[1])
        return f"@{outer} \\({inner}\\)"

    return f"@{normalize_artist_words(trimmed)}"


def clamp_weight(value: float) -> float:
    return max(0.0, min(5.0, float(value)))


def format_segments(
    items: list[str],
    output_format: str,
    prefix: str,
    suffix: str,
    separator: str,
    weight_min: float,
    weight_max: float,
    custom_template: str,
    seed: int,
) -> list[str]:
    if output_format == "tags":
        return [f"{prefix}{item}{suffix}" for item in items]

    if output_format == "anima":
        return [normalize_anima_tag(item) for item in items]

    if output_format == "artist":
        return [f"artist:{clean_artist_tag(item)}" for item in items]

    if output_format == "nai":
        low = clamp_weight(weight_min)
        high = clamp_weight(weight_max)
        if low > high:
            low, high = high, low
        randomizer = random.Random(seed)
        return [
            f"{(low if low == high else round(randomizer.uniform(low, high), 1)):.1f}::{clean_artist_tag(item)} ::"
            for item in items
        ]

    if output_format == "weighted_artist":
        low = clamp_weight(weight_min)
        high = clamp_weight(weight_max)
        if low > high:
            low, high = high, low
        randomizer = random.Random(seed)
        return [
            f"({clean_artist_tag(item)}:{(low if low == high else round(randomizer.uniform(low, high), 1)):.1f})"
            for item in items
        ]

    if output_format == "custom":
        template = custom_template or "{tag}"
        return [
            template.replace("{tag}", item)
            .replace("{clean}", clean_artist_tag(item))
            .replace("{anima}", normalize_anima_tag(item))
            .replace("{index}", str(index + 1))
            for index, item in enumerate(items)
        ]

    return [separator.join(items)]


class UniversalJsonSegmentRandomizer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "file_name": (list_json_files(),),
                "field_paths": ("STRING", {"default": "name", "multiline": False}),
                "extract_count": ("INT", {"default": 1, "min": 1, "max": 200, "step": 1}),
                "mode": (["random", "polling", "sequential"],),
                "duplicate_policy": (["auto", "allow_duplicates", "unique_only"],),
                "output_format": (["anima", "artist", "weighted_artist", "tags", "nai", "custom"],),
                "prefix": ("STRING", {"default": ""}),
                "suffix": ("STRING", {"default": ""}),
                "separator": ("STRING", {"default": ", "}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF}),
                "filter_path": ("STRING", {"default": "", "multiline": False}),
                "filter_value": ("STRING", {"default": "", "multiline": False}),
                "filter_mode": (["contains", "equals", "not_empty"],),
                "weight_min": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 5.0, "step": 0.1}),
                "weight_max": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 5.0, "step": 0.1}),
                "custom_template": ("STRING", {"default": "{tag}", "multiline": False}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("Prompt", "Selected JSON")
    FUNCTION = "extract_segments"
    CATEGORY = "Universal Tools"

    def extract_segments(
        self,
        file_name,
        field_paths,
        extract_count,
        mode,
        duplicate_policy,
        output_format,
        prefix,
        suffix,
        separator,
        seed,
        filter_path,
        filter_value,
        filter_mode,
        weight_min=1.0,
        weight_max=1.0,
        custom_template="{tag}",
        unique_id="",
    ):
        items = load_segments(file_name, field_paths, filter_path, filter_value, filter_mode)
        polling_key = json.dumps(
            {
                "node": str(unique_id or "UniversalJsonSegmentRandomizer"),
                "file": file_name,
                "fields": parse_field_paths(field_paths),
                "filter_path": filter_path,
                "filter_value": filter_value,
                "filter_mode": filter_mode,
                "pool_size": len(items),
                "pool_hash": hashlib.sha256("\0".join(items).encode("utf-8")).hexdigest()[:16],
                "seed": seed,
            },
            sort_keys=True,
            ensure_ascii=False,
        )
        extracted_items = select_items(items, extract_count, mode, seed, duplicate_policy, polling_key=polling_key)
        formatted_items = format_segments(
            extracted_items,
            output_format,
            prefix,
            suffix,
            separator,
            weight_min,
            weight_max,
            custom_template,
            seed,
        )
        return (
            separator.join(formatted_items),
            json.dumps(extracted_items, ensure_ascii=False),
        )
