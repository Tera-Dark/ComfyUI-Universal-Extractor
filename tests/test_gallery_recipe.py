from __future__ import annotations

from py.gallery.recipe import build_prompt_summary, extract_generation_recipe


def comfy_prompt_metadata() -> dict:
    return {
        "workflow": {"nodes": []},
        "prompt": {
            "1": {"class_type": "CLIPTextEncode", "inputs": {"text": "best quality"}},
            "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "low quality"}},
            "3": {"class_type": "EmptyLatentImage", "inputs": {"width": 832, "height": 1216}},
            "4": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": 123,
                    "steps": 28,
                    "cfg": 6.5,
                    "sampler_name": "dpmpp_2m",
                    "scheduler": "karras",
                    "denoise": 0.8,
                    "positive": ["1", 0],
                    "negative": ["2", 0],
                    "latent_image": ["3", 0],
                },
            },
            "5": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
            "6": {
                "class_type": "LoraLoader",
                "inputs": {
                    "lora_name": "style.safetensors",
                    "strength_model": 0.75,
                    "strength_clip": 0.65,
                },
            },
        },
    }


def test_prompt_summary_is_kept_compatible():
    summary = build_prompt_summary(comfy_prompt_metadata())

    assert summary["positive_prompt"] == "best quality"
    assert summary["negative_prompt"] == "low quality"
    assert summary["size"] == "832x1216"
    assert summary["seed"] == 123
    assert summary["sampler"] == "dpmpp_2m"


def test_generation_recipe_extracts_lora_ready_fields():
    recipe = extract_generation_recipe(comfy_prompt_metadata())

    assert recipe == {
        "source_format": "comfy_prompt",
        "has_workflow": True,
        "positive_prompt": "best quality",
        "negative_prompt": "low quality",
        "checkpoint": "model.safetensors",
        "loras": [{"name": "style.safetensors", "strength_model": 0.75, "strength_clip": 0.65}],
        "width": 832,
        "height": 1216,
        "seed": 123,
        "steps": 28,
        "cfg": 6.5,
        "sampler": "dpmpp_2m",
        "scheduler": "karras",
        "denoise": 0.8,
        "lora_manager": {"detected": False, "raw_stack": "", "loras": []},
    }


def test_generation_recipe_fails_softly_without_comfy_prompt():
    recipe = extract_generation_recipe({"prompt": "flat prompt"})

    assert recipe["source_format"] == "unknown"
    assert recipe["loras"] == []
    assert recipe["checkpoint"] == ""
    assert recipe["lora_manager"] == {"detected": False, "raw_stack": "", "loras": []}


def test_generation_recipe_extracts_lora_manager_stack_from_prompt():
    metadata = comfy_prompt_metadata()
    metadata["prompt"]["7"] = {
        "class_type": "Lora Loader (LoraManager)",
        "inputs": {
            "loras": {
                "__value__": [
                    {"name": "anime-highres-aesthetic-boost", "strength": 1, "clipStrength": 0.8, "active": True},
                    {"name": "disabled-style", "strength": 0.5, "active": False},
                ]
            },
            "text": "<lora:lineart-control:0.35>",
        },
    }

    recipe = extract_generation_recipe(metadata)

    assert recipe["lora_manager"] == {
        "detected": True,
        "raw_stack": "<lora:anime-highres-aesthetic-boost:1:0.8>",
        "loras": [
            {"name": "anime-highres-aesthetic-boost", "strength_model": 1, "strength_clip": 0.8, "enabled": True},
        ],
    }


def test_generation_recipe_extracts_lora_manager_stack_from_workflow_widgets():
    metadata = comfy_prompt_metadata()
    metadata["workflow"] = {
        "nodes": [
            {
                "type": "Lora Loader (LoraManager)",
                "title": "Lora Loader (LoraManager)",
                "properties": {
                    "__lm_widget_ids": ["__lm_autocomplete_meta_text", "text", "loras"],
                },
                "widgets_values": [
                    {"version": 1, "textWidgetName": "text"},
                    "<lora:text-only-should-not-win:0.75>",
                    {
                        "__value__": [
                            {"name": "anima_p3_rdbt_v0.29.b.122", "strength": "0.30", "clipStrength": "0.25"},
                            {"name": "inactive-style", "strength": "0.70", "active": False},
                        ],
                    }
                ],
            }
        ]
    }

    recipe = extract_generation_recipe(metadata)

    assert recipe["lora_manager"]["detected"] is True
    assert recipe["lora_manager"]["raw_stack"] == "<lora:anima_p3_rdbt_v0.29.b.122:0.30:0.25>"
    assert recipe["lora_manager"]["loras"] == [
        {
            "name": "anima_p3_rdbt_v0.29.b.122",
            "strength_model": "0.30",
            "strength_clip": "0.25",
            "enabled": True,
        }
    ]


def test_generation_recipe_does_not_fall_back_to_text_when_structured_loras_are_inactive():
    metadata = comfy_prompt_metadata()
    metadata["prompt"]["7"] = {
        "class_type": "Lora Loader (LoraManager)",
        "inputs": {
            "loras": {
                "__value__": [
                    {"name": "grey-style", "strength": 0.5, "active": False},
                ]
            },
            "text": "<lora:grey-style:0.5>",
        },
    }

    recipe = extract_generation_recipe(metadata)

    assert recipe["lora_manager"] == {
        "detected": True,
        "raw_stack": "<lora:grey-style:0.5>",
        "loras": [],
    }


def test_generation_recipe_does_not_treat_generic_workflow_widget_lists_as_loras():
    metadata = comfy_prompt_metadata()
    metadata["workflow"] = {
        "nodes": [
            {
                "type": "Lora Loader (LoraManager)",
                "title": "Lora Loader (LoraManager)",
                "widgets_values": [
                    ["images", ""],
                    ["filename_prefix", "ComfyUI"],
                    ["file_format", "png"],
                    {
                        "__value__": [
                            {"name": "real-style", "strength": 0.45, "clipStrength": 0.35},
                        ],
                    },
                ],
                "inputs": [
                    {"label": "images", "name": "images", "type": "IMAGE", "link": 203},
                    {"label": "filename_prefix", "name": "filename_prefix", "type": "STRING"},
                    {"label": "file_format", "name": "file_format", "type": "COMBO"},
                ],
            }
        ]
    }

    recipe = extract_generation_recipe(metadata)

    assert recipe["lora_manager"]["loras"] == [
        {
            "name": "real-style",
            "strength_model": 0.45,
            "strength_clip": 0.35,
            "enabled": True,
        }
    ]
    assert "images" not in recipe["lora_manager"]["raw_stack"]
