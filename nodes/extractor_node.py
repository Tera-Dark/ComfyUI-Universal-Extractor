import os
import json
import random

def get_data_dirs():
    current_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(current_dir, "data")
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    return data_dir

def list_json_files():
    data_dir = get_data_dirs()
    if not os.path.exists(data_dir):
        return ["None"]
    files = [f for f in os.listdir(data_dir) if f.endswith(".json")]
    return files if files else ["None"]


class UniversalTextExtractor:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        files = list_json_files()
        return {
            "required": {
                "file_name": (files,),
                "extract_count": ("INT", {"default": 1, "min": 1, "max": 100, "step": 1}),
                "mode": (["random", "sequential"],),
                "prefix": ("STRING", {"default": ""}),
                "suffix": ("STRING", {"default": ""}),
                "separator": ("STRING", {"default": ", "}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("Prompt",)

    FUNCTION = "extract"

    CATEGORY = "Universal Tools"

    def extract(self, file_name, extract_count, mode, prefix, suffix, separator, seed):
        if file_name == "None":
            return ("",)

        data_dir = get_data_dirs()
        file_path = os.path.join(data_dir, file_name)

        if not os.path.exists(file_path):
            return ("",)

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f"[Universal Extractor] Error loading json: {e}")
            return ("",)

        if not isinstance(data, list) or len(data) == 0:
            return ("",)

        # Assuming data is a list of objects like artist-generator or list of strings
        # E.g. [{"prompt": "artist A"}, {"prompt": "artist B"}] or ["word1", "word2"]
        extracted_items = []
        
        # Determine internal strings
        items = []
        for v in data:
            if isinstance(v, str):
                items.append(v)
            elif isinstance(v, dict):
                # prioritize 'prompt' key as in artist-generator
                if 'prompt' in v:
                    items.append(v['prompt'])
                elif 'name' in v:
                    items.append(v['name'])
                elif 'title' in v:
                    items.append(v['title'])
            elif isinstance(v, list):
                if len(v) > 0 and isinstance(v[0], str):
                    items.append(v[0])

        if not items:
            print("[Universal Extractor] No valid items found in JSON format.")
            return ("",)

        if mode == "random":
            rand = random.Random(seed)
            if extract_count > len(items):
                # Allow duplicates if extracting more than available
                extracted_items = [rand.choice(items) for _ in range(extract_count)]
            else:
                extracted_items = rand.sample(items, extract_count)
        elif mode == "sequential":
            start_index = seed % len(items)
            for i in range(extract_count):
                idx = (start_index + i) % len(items)
                extracted_items.append(items[idx])

        # Format and join
        formatted_items = [f"{prefix}{item}{suffix}" for item in extracted_items]
        result = separator.join(formatted_items)

        return (result,)
