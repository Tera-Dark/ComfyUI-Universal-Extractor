# Changelog

## 1.2.8 - 2026-07-02

- Fixed image LoRA stack application so repeated sends keep only the latest image's active LoRAs enabled while preserving older entries as inactive.
- Ignored inactive LoRA Manager entries when building image recipes, preventing greyed-out LoRAs from being sent back into the current workflow.
- Added local release notes fallback for the update popover so the current version can show a changelog before or without a populated GitHub Release body.

