"""Browser-level gallery -> ComfyUI tab protocol compatibility smoke test.

Build the gallery, run `python scripts/preview.py --port 8189`, then run
`python scripts/browser_lora_stack_channel.py http://127.0.0.1:8189`.
The ComfyUI tab is a same-origin message receiver, NOT a ComfyUI installation;
separate Node tests execute the pinned upstream LoRA Manager callbacks/setter.
"""
from __future__ import annotations

import asyncio
import sys

from playwright.async_api import async_playwright, expect

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8189"


async def run_case(browser, *, compatible: bool, mode: str = "append"):
    context = await browser.new_context(viewport={"width": 1440, "height": 800})
    try:
        comfy = await context.new_page()
        await comfy.route("**/fake-comfy", lambda route: route.fulfill(content_type="text/html", body="<html><body>Test ComfyUI tab</body></html>"))
        await comfy.goto(BASE + "/fake-comfy")
        await comfy.evaluate("""(compatible) => {
          window.__loraStackMessages = [];
          const channel = new BroadcastChannel('universal-extractor-workflow');
          window.__comfyChannel = channel;
          channel.onmessage = (event) => {
            const message = event.data;
            if (message.type === 'universal-extractor:workflow-probe') {
              channel.postMessage({
                type:'universal-extractor:workflow-ack', probeId:message.probeId,
                instanceId:'test-main-tab', focused:true, visibilityState:'visible',
                ...(compatible ? {loraStackProtocol:2} : {}),
              });
            }
            if (message.type === 'universal-extractor:lora-stack-message') {
              window.__loraStackMessages.push(message);
              channel.postMessage({
                type:'universal-extractor:lora-stack-delivered',
                instanceId:'test-main-tab', payloadId:message.payload.id,
                ...(compatible ? {loraStackProtocol:2} : {}),
                ok:true, summary:{target:'LoRA test node',applied:1,added:1,updated:0,removed:0},
              });
            }
          };
        }""", compatible)
        gallery = await context.new_page()
        await gallery.add_init_script("""
          localStorage.setItem('universal-extractor-locale','zh-CN');
          localStorage.setItem('universal-extractor:onboarding-tour-v1-completed','true');
          localStorage.setItem('universal-extractor:ui-preferences',JSON.stringify({
            enableImagePrefetch:false,enableLiveGalleryRefresh:false
          }));
        """)
        async def metadata_with_stack(route):
            response = await route.fetch()
            body = await response.json()
            body["recipe"]["lora_manager"] = {
                "detected": True,
                "raw_stack": "<lora:from-image:0.8:0.3>",
                "loras": [{"name": "from-image", "strength_model": 0.8,
                           "strength_clip": 0.3, "enabled": True}],
            }
            await route.fulfill(json=body)
        await gallery.route("**/universal_gallery/api/metadata?*", metadata_with_stack)
        errors: list[str] = []
        gallery.on("pageerror", lambda error: errors.append(str(error)))
        await gallery.goto(BASE + "/gallery/", wait_until="networkidle")
        await expect(gallery.locator(".ue-gallery-card").first).to_be_visible()
        await gallery.locator(".ue-gallery-card").first.click(button="right")
        await gallery.get_by_role("button", name="应用 LoRA 堆到当前工作流").click()
        dialog = gallery.get_by_role("alertdialog")
        await expect(dialog).to_be_visible()
        await dialog.get_by_role("button", name="追加到原堆" if mode == "append" else "覆盖旧堆").click()
        if compatible:
            await expect(gallery.get_by_text("已将 1 个 LoRA 合并到“LoRA test node”" if mode == "append"
                                             else "已用 1 个 LoRA 覆盖“LoRA test node”")).to_be_visible(timeout=4500)
        else:
            await expect(gallery.get_by_text("当前 ComfyUI 页面仍运行旧版插件脚本", exact=False)).to_be_visible(timeout=4500)
        messages = await comfy.evaluate("window.__loraStackMessages")
        if compatible:
            assert len(messages) == 1 and messages[0]["payload"]["mode"] == mode, messages
        else:
            assert not messages, "old ComfyUI code received a destructive write request"
        assert not errors, errors
        print(f"PASS browser gallery mode={mode}, protocol={'2' if compatible else 'old'}: "
              f"{len(messages)} LoRA writes, correct status message")
    finally:
        await context.close()


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        try:
            await run_case(browser, compatible=False)
            await run_case(browser, compatible=True, mode="append")
            await run_case(browser, compatible=True, mode="replace")
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
