"""Production-build browser regression for workspace-scoped loading and lazy UI.

Run `npm run build` in gallery_ui, start `python scripts/preview.py --port 8189`,
then run `python scripts/browser_optimization_smoke.py http://127.0.0.1:8189`.
The isolated preview has synthetic sample images; this is not a ComfyUI test.
"""
from __future__ import annotations

import asyncio
import sys

from playwright.async_api import async_playwright, expect

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8189"

PREFERENCES = """
  localStorage.setItem('universal-extractor-locale', 'zh-CN');
  localStorage.setItem('universal-extractor:onboarding-tour-v1-completed', 'true');
  localStorage.setItem('universal-extractor:ui-preferences', JSON.stringify({
    enableImagePrefetch: false, enableLiveGalleryRefresh: false
  }));
"""


async def main() -> None:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(args=["--no-sandbox"])
        try:
            context = await browser.new_context(viewport={"width": 1440, "height": 900})
            await context.add_init_script(PREFERENCES)
            page = await context.new_page()
            requests: list[str] = []
            errors: list[str] = []
            page.on("request", lambda request: requests.append(request.url))
            page.on("pageerror", lambda error: errors.append(str(error)))

            # Opening a deep link into the library must not request gallery rows
            # or ship optional gallery-mode/modal JS on the first screen.
            await page.goto(BASE + "/gallery/?tab=library", wait_until="networkidle")
            await expect(page.get_by_text("Demo prompts.json").first).to_be_visible()
            assert any("/LibraryWorkspace-" in url for url in requests), requests
            assert not any("/api/images?" in url or "/api/images/freshness" in url
                           for url in requests), requests
            assert not any("/DualFolderWorkspace-" in url or "/ImageDetailModal-" in url
                           or "/VariantGroupsView-" in url for url in requests), requests
            print("PASS library deep link: no gallery image requests or optional gallery chunks")

            requests.clear()
            await page.goto(BASE + "/gallery/", wait_until="networkidle")
            await expect(page.locator(".ue-gallery-card").first).to_be_visible()
            assert not any("/ImageDetailModal-" in url or "/DualFolderWorkspace-" in url
                           or "/VariantGroupsView-" in url for url in requests), requests
            await page.locator('[data-tour-id="gallery-density"]').click()
            await expect(page.locator(".ue-density-panel output")).to_have_text("6")
            await page.keyboard.press("Escape")
            print("PASS fresh desktop: six-column preference and optional UI not fetched")

            # An existing user preference wins over the new default; Reset is
            # an explicit user action and writes six for later sessions.
            await page.evaluate("localStorage.setItem('universal-extractor:grid-columns', '4')")
            await page.reload(wait_until="networkidle")
            await page.locator('[data-tour-id="gallery-density"]').click()
            await expect(page.locator(".ue-density-panel output")).to_have_text("4")
            await page.get_by_role("button", name="恢复默认（每行 6 张）").click()
            await expect(page.locator(".ue-density-panel output")).to_have_text("6")
            assert await page.evaluate("localStorage.getItem('universal-extractor:grid-columns')") == "6"
            await page.keyboard.press("Escape")
            print("PASS saved density: respected; explicit reset persists six")

            requests.clear()
            await page.locator(".ue-gallery-card img").first.click()
            await expect(page.locator(".ue-lightbox-shell")).to_be_visible()
            assert any("/ImageDetailModal-" in url for url in requests), requests
            await page.keyboard.press("Escape")
            await expect(page.locator(".ue-lightbox-shell")).to_have_count(0)
            print("PASS image detail: lazy chunk fetched only on demand")

            requests.clear()
            await page.locator('summary[aria-label="更多操作"]').click()
            await page.get_by_role("button", name="开启双栏目录整理").click()
            await expect(page.locator(".ue-dual-workspace")).to_be_visible()
            assert any("/DualFolderWorkspace-" in url for url in requests), requests
            await page.locator('summary[aria-label="更多操作"]').click()
            await page.get_by_role("button", name="关闭双栏目录整理").click()
            await expect(page.locator(".ue-gallery-card").first).to_be_visible()
            print("PASS dual-folder mode: lazy chunk fetched, return restores gallery")

            requests.clear()
            await page.locator('summary[aria-label="更多操作"]').click()
            await page.get_by_role("button", name="变体", exact=True).click()
            await expect(page.locator(".ue-variant-workspace")).to_be_visible()
            assert any("/VariantGroupsView-" in url for url in requests), requests
            assert not errors, errors
            print("PASS variants: lazy chunk fetched; no page errors")
            await context.close()

            # Broken/blocked browser storage must not prevent the gallery from
            # painting or cause an uncaught page error.
            blocked = await browser.new_context(viewport={"width": 1440, "height": 900})
            await blocked.add_init_script("""
              Storage.prototype.getItem = () => { throw new DOMException('denied', 'SecurityError'); };
              Storage.prototype.setItem = () => { throw new DOMException('denied', 'SecurityError'); };
              Storage.prototype.removeItem = () => { throw new DOMException('denied', 'SecurityError'); };
            """)
            page = await blocked.new_page()
            storage_errors: list[str] = []
            page.on("pageerror", lambda error: storage_errors.append(str(error)))
            await page.goto(BASE + "/gallery/", wait_until="networkidle")
            await expect(page.locator(".ue-gallery-card").first).to_be_visible()
            assert not storage_errors, storage_errors
            print("PASS blocked localStorage: gallery rendered without uncaught errors")
            await blocked.close()
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
