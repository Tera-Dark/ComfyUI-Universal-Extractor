import json
import os
import random

from ..constants import DATA_DIR


def list_json_files():
    os.makedirs(DATA_DIR, exist_ok=True)
    files = [
        filename
        for filename in os.listdir(DATA_DIR)
        if filename.endswith(".json") and filename != "gallery_state.json"
    ]
    return files if files else ["None"]


def load_entries(file_name: str):
    if file_name == "None":
        return []

    file_path = os.path.join(DATA_DIR, file_name)
    if not os.path.exists(file_path):
        return []

    try:
        with open(file_path, "r", encoding="utf-8") as file:
            data = json.load(file)
    except Exception as error:
        print(f"[Universal Extractor] Error loading json: {error}")
        return []

    if not isinstance(data, list):
        return []

    items = []
    for value in data:
        if isinstance(value, str):
            items.append(value)
        elif isinstance(value, dict):
            for key in ("prompt", "name", "title"):
                item = value.get(key)
                if isinstance(item, str) and item:
                    items.append(item)
                    break
        elif isinstance(value, list) and value and isinstance(value[0], str):
            items.append(value[0])

    return items


class UniversalTextExtractor:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "file_name": (list_json_files(),),
                "extract_count": ("INT", {"default": 1, "min": 1, "max": 100, "step": 1}),
                "mode": (["random", "sequential"],),
                "prefix": ("STRING", {"default": ""}),
                "suffix": ("STRING", {"default": ""}),
                "separator": ("STRING", {"default": ", "}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("Prompt",)
    FUNCTION = "extract"
    CATEGORY = "Universal Tools"

    def extract(self, file_name, extract_count, mode, prefix, suffix, separator, seed):
        items = load_entries(file_name)
        if not items:
            return ("",)

        if mode == "random":
            randomizer = random.Random(seed)
            if extract_count > len(items):
                extracted_items = [randomizer.choice(items) for _ in range(extract_count)]
            else:
                extracted_items = randomizer.sample(items, extract_count)
        else:
            start_index = seed % len(items)
            extracted_items = [items[(start_index + index) % len(items)] for index in range(extract_count)]

        formatted_items = [f"{prefix}{item}{suffix}" for item in extracted_items]
        return (separator.join(formatted_items),)
