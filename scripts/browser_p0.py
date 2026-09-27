"""P0 user-flow regressions against the isolated preview (never a real ComfyUI gallery).

Run after `npm run build` and `python scripts/preview.py --host 0.0.0.0 --port 8189`:
    python scripts/browser_p0.py http://127.0.0.1:8189
API failures/partial results are injected in the browser and do not alter demo files.
"""
from __future__ import annotations

import asyncio
import json
import sys
from urllib.parse import parse_qs, urlsplit

from playwright.async_api import async_playwright, expect

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8189"


async def new_gallery(browser, errors, width=1440):
    page = await browser.new_page(viewport={"width": width, "height": 960 if width > 600 else 844})
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.add_init_script(
        "localStorage.setItem('universal-extractor-locale','zh-CN');"
        "localStorage.setItem('universal-extractor:onboarding-tour-v1-completed','true')"
    )
    await page.goto(BASE + "/gallery/", wait_until="networkidle")
    await expect(page.locator(".ue-gallery-card").first).to_be_visible()
    return page


async def open_detail(page):
    await page.locator(".ue-gallery-card img").first.click()
    await expect(page.locator(".ue-lightbox-shell")).to_be_visible()


async def select_two(page):
    cards = page.locator(".ue-gallery-card")
    paths = []
    for index in range(2):
        url = await cards.nth(index).locator("img").get_attribute("src")
        paths.append(parse_qs(urlsplit(url or "").query)["relative_path"][0])
        await cards.nth(index).locator(".ue-select-btn").click()
    await expect(page.locator(".ue-gallery-inspector")).to_contain_text("已选 2 项")
    return paths


async def slow_metadata_keeps_draft(browser, errors):
    page = await new_gallery(browser, errors)
    release = asyncio.Event()

    async def slow_metadata(route):
        response = await route.fetch()
        await asyncio.wait_for(release.wait(), timeout=8)
        await route.fulfill(response=response)

    await page.route("**/universal_gallery/api/metadata?*", slow_metadata)
    try:
        await open_detail(page)
        await page.locator(".ue-lightbox-toolbar button[aria-label='显示或隐藏侧边信息']").click()
        panel = page.locator(".ue-lightbox-inspector.is-open")
        title = panel.locator(".ue-detail-form input").first
        await expect(panel.locator(".ue-detail-savebar button").first).to_be_disabled()
        await title.fill("P0 未提交的标题")
        await page.locator(".ue-lightbox-toolbar button[aria-label='下一页']").click()
        dialog = page.get_by_role("alertdialog")
        await expect(dialog.get_by_role("button", name="保存并继续")).to_be_disabled()
        await dialog.get_by_role("button", name="取消").click()
        await expect(title).to_have_value("P0 未提交的标题")
        release.set()
        await expect(panel.locator(".ue-detail-state .ue-loading-orb")).to_have_count(0)
        await expect(title).to_have_value("P0 未提交的标题")
        await expect(panel.locator(".ue-detail-savecopy strong").first).to_have_text("未保存")
        current_name = await page.locator(".ue-lightbox-filmstrip-item.is-active").get_attribute("aria-label")
        await page.locator(".ue-lightbox-toolbar button[aria-label='下一页']").click()
        await page.get_by_role("alertdialog").get_by_role("button", name="放弃修改").click()
        await expect(page.locator(".ue-lightbox-filmstrip-item.is-active")).not_to_have_attribute("aria-label", current_name)
    finally:
        release.set()
        await page.close()
    print("PASS: slow Metadata cannot overwrite draft; navigation offers cancel/discard; saving waits for load")


async def pending_save_locks_editor(browser, errors):
    page = await new_gallery(browser, errors)
    started, release = asyncio.Event(), asyncio.Event()

    async def save_without_changing_demo(route):
        updates = route.request.post_data_json["updates"]
        started.set()
        await asyncio.wait_for(release.wait(), timeout=8)
        await route.fulfill(json={
            "ok": True,
            "state": {"favorite": False, "pinned": False, "boards": [], "category": updates["category"],
                      "title": updates["title"], "notes": updates["notes"], "updated_at": 1},
            "categories": [],
        })

    await page.route("**/universal_gallery/api/image-state", save_without_changing_demo)
    try:
        await open_detail(page)
        await page.locator(".ue-lightbox-toolbar button[aria-label='显示或隐藏侧边信息']").click()
        panel = page.locator(".ue-lightbox-inspector.is-open")
        title = panel.locator(".ue-detail-form input").first
        await expect(panel.locator(".ue-detail-state .ue-loading-orb")).to_have_count(0)
        await title.fill("正在保存时不应再次编辑")
        old_name = await page.locator(".ue-lightbox-filmstrip-item.is-active").get_attribute("aria-label")
        await page.locator(".ue-lightbox-toolbar button[aria-label='下一页']").click()
        await page.get_by_role("alertdialog").get_by_role("button", name="保存并继续").click()
        await asyncio.wait_for(started.wait(), timeout=5)
        await expect(title).to_be_disabled()
        await expect(panel.locator(".ue-detail-form input").nth(1)).to_be_disabled()
        await expect(page.locator(".ue-lightbox-toolbar button[aria-label='Pin 图']")).to_be_disabled()
        release.set()
        await expect(page.locator(".ue-lightbox-filmstrip-item.is-active")).not_to_have_attribute("aria-label", old_name)
    finally:
        release.set()
        await page.close()
    print("PASS: editor is locked while save-and-continue is in flight; save advances only after response")


async def filename_and_workspace_guard(browser, errors):
    page = await new_gallery(browser, errors)
    try:
        await open_detail(page)
        await page.locator(".ue-lightbox-toolbar button[aria-label='显示或隐藏侧边信息']").click()
        panel = page.locator(".ue-lightbox-inspector.is-open")
        filename = panel.locator(".ue-detail-form input").nth(1)
        await filename.fill("draft-filename.png")
        await expect(panel.locator(".ue-detail-savecopy strong").first).to_have_text("未保存")
        await expect(panel.locator(".ue-detail-savebar button").first).to_be_disabled()

        # A programmatic top-bar action models keyboard focus reaching behind the lightbox.
        # The App's workspace guard must protect the draft even without pointer interaction.
        switch_to_library = "document.querySelectorAll('.ue-workspace-switcher .ue-topbar-tab')[1].click()"
        await page.evaluate(switch_to_library)
        await page.get_by_role("alertdialog").get_by_role("button", name="取消").click()
        await expect(filename).to_have_value("draft-filename.png")
        await expect(page.locator(".ue-lightbox-shell")).to_be_visible()
        await page.evaluate(switch_to_library)
        await page.get_by_role("alertdialog").get_by_role("button", name="放弃修改").click()
        await expect(page.locator(".ue-lightbox-shell")).to_have_count(0)
        await expect(page.locator(".ue-workspace-switcher > summary")).to_contain_text("词库")
    finally:
        await page.close()
    print("PASS: filename-only edit is unsaved; workspace switch is guarded and can be cancelled")


async def single_delete_500(browser, errors):
    page = await new_gallery(browser, errors)
    await page.route("**/universal_gallery/api/images/delete", lambda route: route.fulfill(
        status=500, content_type="application/json", body=json.dumps({"error": "P0 模拟删除失败"})
    ))
    try:
        await open_detail(page)
        await page.locator(".ue-lightbox-toolbar button[aria-label='删除文件']").click()
        await page.get_by_role("alertdialog").get_by_role("button", name="删除").click()
        await expect(page.locator(".ue-lightbox-action-error")).to_contain_text("P0 模拟删除失败")
        await expect(page.locator(".ue-lightbox-shell")).to_be_visible()
        await expect(page.locator(".ue-operation-card--error")).to_contain_text("P0 模拟删除失败")
    finally:
        await page.close()
    print("PASS: HTTP 500 on single delete keeps the detail open and shows an error")


async def partial_move(browser, errors):
    page = await new_gallery(browser, errors)
    try:
        first, second = await select_two(page)
        context = await (await page.request.get(BASE + "/universal_gallery/api/context")).json()
        requests = []

        async def partial_response(route):
            requests.append(route.request.post_data_json)
            await route.fulfill(json={
                "ok": True, "moved": ["target/" + first.rsplit("/", 1)[-1]], "moved_sources": [first],
                "missing": [second], "blocked": [], "unchanged": [],
                "categories": context["categories"], "subfolders": context["subfolders"],
            })

        await page.route("**/universal_gallery/api/images/move", partial_response)
        panel = page.locator(".ue-gallery-inspector")
        await panel.locator("select").select_option(index=2)
        await panel.get_by_role("button", name="移动到目录").click()
        await page.get_by_role("alertdialog").get_by_role("button", name="移动").click()
        await expect(panel).to_contain_text("已选 1 项")
        assert requests and requests[0]["relative_paths"] == [first, second], requests
        cards = page.locator(".ue-gallery-card")
        await expect(cards.nth(0)).not_to_have_class("ue-gallery-card is-selected")
        await expect(cards.nth(1)).to_have_class("ue-gallery-card is-selected")
        error = page.locator(".ue-operation-card--error")
        await expect(error).to_contain_text("已移动 1 张")
        await error.locator("summary").click()
        await expect(error).to_contain_text(second)
        await page.wait_for_timeout(3900)
        await expect(error).to_be_visible()
    finally:
        await page.close()
    print("PASS: partial move reports actual counts, retains only failed selection and durable path details")


async def batch_delete_500(browser, errors):
    page = await new_gallery(browser, errors)
    try:
        await select_two(page)
        await page.route("**/universal_gallery/api/images/delete", lambda route: route.fulfill(
            status=500, content_type="application/json", body=json.dumps({"error": "P0 模拟批量删除失败"})
        ))
        panel = page.locator(".ue-gallery-inspector")
        await panel.get_by_role("button", name="删除所选").click()
        await page.get_by_role("alertdialog").get_by_role("button", name="删除").click()
        await expect(panel).to_contain_text("已选 2 项")
        await expect(page.locator(".ue-gallery-card.is-selected")).to_have_count(2)
        await expect(page.locator(".ue-operation-card--error")).to_contain_text("P0 模拟批量删除失败")
    finally:
        await page.close()
    print("PASS: HTTP 500 on batch delete keeps both selections and the inspector")


async def main():
    errors = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(args=["--no-sandbox"])
        try:
            await slow_metadata_keeps_draft(browser, errors)
            await pending_save_locks_editor(browser, errors)
            await filename_and_workspace_guard(browser, errors)
            await single_delete_500(browser, errors)
            await partial_move(browser, errors)
            await batch_delete_500(browser, errors)
            assert not errors, errors
        finally:
            await browser.close()
    print("PASS: P0 browser acceptance; no page errors; isolated demo unchanged")


if __name__ == "__main__":
    asyncio.run(main())
