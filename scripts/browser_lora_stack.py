"""Isolated real-browser regression for gallery -> ComfyUI LoRA-stack actions.

Build the gallery, start `python scripts/preview.py --host 0.0.0.0 --port 8189`,
then `python scripts/browser_lora_stack.py http://127.0.0.1:8189`.
The metadata and ComfyUI receiver are intercepted/injected; no real workflow
or image files are changed. The actual bridge is separately tested by Node.
"""
from __future__ import annotations

import asyncio
import sys
from playwright.async_api import async_playwright, expect

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8189"

RECEIVER = r"""
(() => {
  localStorage.setItem('universal-extractor-locale', 'zh-CN');
  localStorage.setItem('universal-extractor:onboarding-tour-v1-completed', 'true');
  localStorage.setItem('universal-extractor:ui-preferences', JSON.stringify({
    enableImagePrefetch: false, enableLiveGalleryRefresh: false
  }));
  const channel = new BroadcastChannel('universal-extractor-workflow');
  const info = window.__ueTest = { received: [], wrongSent: false, replyError: '' };
  channel.addEventListener('message', ({data}) => {
    if (data.type === 'universal-extractor:workflow-probe') {
      channel.postMessage({type: 'universal-extractor:workflow-ack',
        instanceId:'background',probeId:data.probeId,focused:false,visibilityState:'hidden'});
      channel.postMessage({type: 'universal-extractor:workflow-ack',
        instanceId:'active',probeId:data.probeId,focused:true,visibilityState:'visible'});
    }
    if (data.type === 'universal-extractor:lora-stack-message') {
      info.received.push(data);
      const id = data.payload.id;
      // A background ComfyUI tab tries to claim delivery first: it must not
      // finish the gallery operation that is addressed to the active tab.
      setTimeout(() => {
        channel.postMessage({type:'universal-extractor:lora-stack-delivered',
          instanceId:'background',payloadId:id,ok:true,summary:{target:'WRONG',applied:50,added:50,updated:0,removed:0}});
        info.wrongSent = true;
      }, 40);
      setTimeout(() => {
        const replace = data.payload.mode === 'replace';
        channel.postMessage({type:'universal-extractor:lora-stack-delivered',
          instanceId:'active',payloadId:id,ok:!info.replyError,
          error:info.replyError || null,
          summary:{target:'LoRA target',applied:2,added:replace?2:1,updated:replace?0:1,removed:replace?3:0}});
      }, 800);
    }
  });
})();
"""


async def main():
    errors = []
    state = {"valid": True}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(args=["--no-sandbox"])
        page = await browser.new_page(viewport={"width": 1100, "height": 780}, reduced_motion="reduce")
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.add_init_script(RECEIVER)

        async def metadata(route):
            response = await route.fetch()
            data = await response.json()
            recipe = data.get("recipe") or {}
            stack = [
                {"name": "A", "strength_model": .8, "strength_clip": .8, "enabled": True},
                {"name": "A", "strength_model": 1.2, "strength_clip": 0, "enabled": True},
                {"name": "B", "strength_model": .7, "strength_clip": .7, "enabled": True},
            ] if state["valid"] else []
            recipe["lora_manager"] = {"detected": state["valid"], "raw_stack": "", "loras": stack}
            recipe["loras"] = stack
            data["recipe"] = recipe
            await route.fulfill(json=data)

        await page.route("**/universal_gallery/api/metadata?*", metadata)
        await page.goto(BASE + "/gallery/", wait_until="networkidle")
        card = page.locator(".ue-gallery-card").first
        await expect(card).to_be_visible()

        async def open_from_context():
            await card.click(button="right")
            await page.get_by_role("button", name="应用 LoRA 堆到当前工作流").click()
            dialog = page.get_by_role("alertdialog")
            await expect(dialog).to_be_visible()
            return dialog

        dialog = await open_from_context()
        text = await dialog.inner_text()
        assert "2 个 LoRA" in text, text  # deduped before confirming
        assert "CLIP 强度与主强度不同" in text and "同步覆盖 CLIP" in text, text
        assert await dialog.locator("#ue-confirm-body").evaluate("el => getComputedStyle(el).whiteSpace") == "pre-line"
        for label in ["取消", "追加到原堆", "覆盖旧堆"]:
            await expect(dialog.get_by_role("button", name=label)).to_be_visible()
        await dialog.get_by_role("button", name="取消").click()
        assert await page.evaluate("window.__ueTest.received.length") == 0

        dialog = await open_from_context()
        await dialog.get_by_role("button", name="追加到原堆").click()
        # The preview's CSP intentionally disallows eval-based polling.
        await asyncio.sleep(1.2)  # probe (900 ms) + the wrong receipt (40 ms)
        assert await page.evaluate("window.__ueTest.wrongSent")
        assert await page.locator(".ue-operation-card--success").filter(has_text="WRONG").count() == 0
        assert await page.locator(".ue-operation-card--pending").filter(has_text="应用 LoRA").count() == 1, "a background tab must not end the operation"
        await expect(page.locator(".ue-operation-card--success").filter(has_text="已将 2 个 LoRA 合并到“LoRA target”")).to_be_visible(timeout=6000)
        await expect(page.locator(".ue-operation-card--success").filter(has_text="新增 1 项，同名更新 1 项")).to_be_visible()
        received = await page.evaluate("window.__ueTest.received")
        assert len(received) == 1 and received[0]["targetInstanceId"] == "active", received
        assert received[0]["payload"]["mode"] == "append", received

        # The detail-page button must have exactly the same three choices.
        await card.locator("img").first.click()
        detail = page.locator(".ue-lightbox-shell")
        await expect(detail).to_be_visible()
        detail_button = detail.get_by_role("button", name="应用 LoRA 堆到当前工作流")
        await expect(detail_button).to_be_visible()
        await detail_button.click()
        dialog = page.get_by_role("alertdialog")
        await expect(dialog).to_be_visible()
        await page.set_viewport_size({"width": 390, "height": 780})
        await expect(dialog.get_by_role("button", name="覆盖旧堆")).to_be_visible()
        assert not await page.evaluate("document.documentElement.scrollWidth > innerWidth"), "mobile horizontal overflow"
        for label in ["取消", "追加到原堆", "覆盖旧堆"]:
            rect = await dialog.get_by_role("button", name=label).bounding_box()
            assert rect and rect["x"] >= 0 and rect["x"] + rect["width"] <= 391, (label, rect)
        await dialog.get_by_role("button", name="覆盖旧堆").click()
        await expect(page.locator(".ue-operation-card--success").filter(has_text="已用 2 个 LoRA 覆盖“LoRA target”")).to_be_visible(timeout=6000)
        await expect(page.locator(".ue-operation-card--success").filter(has_text="移除旧条目 3 项")).to_be_visible()
        received = await page.evaluate("window.__ueTest.received")
        assert len(received) == 2 and received[-1]["payload"]["mode"] == "replace", received

        # A receiver failure stays visible; an empty recipe must never open
        # a destructive confirmation or dispatch a third stack.
        state["valid"] = False
        await detail_button.click()
        await expect(page.locator(".ue-operation-card--error").filter(has_text="未识别到可用")).to_be_visible()
        await expect(page.get_by_role("alertdialog")).to_have_count(0)
        assert await page.evaluate("window.__ueTest.received.length") == 2

        state["valid"] = True
        await page.evaluate("window.__ueTest.replyError = 'receiver refused the stack'")
        await detail_button.click()
        await page.get_by_role("alertdialog").get_by_role("button", name="追加到原堆").click()
        await expect(page.locator(".ue-operation-card--error").filter(has_text="receiver refused the stack")).to_be_visible(timeout=6000)
        assert await page.evaluate("window.__ueTest.received.length") == 3
        assert not errors, errors
        await browser.close()
    print("PASS: context and detail append/replace/cancel, deduplicated count, CLIP warning, mobile actions, targeted async receipts, missing-stack and error feedback. No page errors.")


if __name__ == "__main__":
    asyncio.run(main())
