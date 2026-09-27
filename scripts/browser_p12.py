"""P1/P2 browser regression against scripts/preview.py's TEMPORARY demo data only.

Build first, then start `python scripts/preview.py --host 0.0.0.0 --port 8189`.
Run `python scripts/browser_p12.py http://127.0.0.1:8189`.
The import case writes a single image into the ephemeral preview directory, not ComfyUI.
Large-library performance, real ComfyUI workflow delivery, and other engines/devices
require separate manual acceptance and are NOT covered by this script.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from urllib.parse import parse_qs, urlsplit

from playwright.async_api import async_playwright, expect

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8189"


def query(url: str, key: str) -> str:
    return parse_qs(urlsplit(url).query).get(key, [""])[0]


async def new_page(browser, errors, *, path="/gallery/", width=1440, live=False, before=None):
    page = await browser.new_page(viewport={"width": width, "height": 960 if width > 600 else 844})
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.add_init_script("""
      localStorage.setItem('universal-extractor-locale','zh-CN');
      localStorage.setItem('universal-extractor:onboarding-tour-v1-completed','true');
      localStorage.setItem('universal-extractor:ui-preferences',JSON.stringify({enableLiveGalleryRefresh:%s}));
    """ % ("true" if live else "false"))
    if before:
        await before(page)
    await page.goto(BASE + path, wait_until="networkidle")
    return page


async def gallery(browser, errors, **kwargs):
    page = await new_page(browser, errors, **kwargs)
    await expect(page.locator(".ue-gallery-card").first).to_be_visible()
    return page


async def switch_tab(page, index):
    await page.locator('[data-tour-id="workspace-switcher"]').click()
    await page.locator('.ue-workspace-switcher .ue-topbar-tab').nth(index).click()


async def open_mode(page, name):
    await page.locator(".ue-toolbar-more > summary").click()
    await page.get_by_role("button", name=name, exact=True).click()


async def slow_source_and_empty(browser, errors):
    page = await gallery(browser, errors)
    started, release = asyncio.Event(), asyncio.Event()
    async def slow_input(route):
        if query(route.request.url, "subfolder") == "default_input::":
            started.set()
            await asyncio.wait_for(release.wait(), 12)
        await route.continue_()
    await page.route("**/universal_gallery/api/images?*", slow_input)
    try:
        await page.locator(".ue-gallery-card .ue-select-btn").first.click()
        await expect(page.locator(".ue-gallery-inspector")).to_contain_text("已选 1 项")
        await page.locator(".ue-sidebar-quick button").filter(has_text="输入图库").click()
        await asyncio.wait_for(started.wait(), 7)
        await expect(page.locator(".ue-filter-kicker")).to_have_text("ComfyUI Input")
        await expect(page.locator(".ue-gallery-card")).to_have_count(0)
        await expect(page.locator(".ue-gallery-inspector")).to_have_count(0)
        await expect(page.locator(".ue-filter-summary strong")).to_have_text("0")
        release.set()
        await expect(page.locator(".ue-gallery-state--empty h3")).to_have_text("这个图源还没有图片")
        assert query(page.url, "folder") == "default_input::", page.url
    finally:
        release.set()
        await page.close()
    print("PASS P1-1/P2-1: delayed source switch hides stale pictures/selection, labels input, shows empty-source guidance")


async def library_race_and_ime(browser, errors):
    page = await gallery(browser, errors)
    started, latest_started, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
    queries = []
    async def slow_soft(route):
        term = query(route.request.url, "search")
        queries.append(term)
        if term == "Soft":
            started.set()
            response = await route.fetch()
            await asyncio.wait_for(release.wait(), 12)
            await route.fulfill(response=response)
        else:
            if term == "neverxyz":
                latest_started.set()
            await route.continue_()
    try:
        await switch_tab(page, 1)
        await page.locator(".ue-library-main").first.click()
        await expect(page.locator(".ue-library-row")).to_have_count(2)
        # Keyboard activation is a native button, not an inaccessible clickable div.
        await page.locator(".ue-library-main").first.focus()
        await page.keyboard.press("Enter")
        await expect(page.locator(".ue-library-row")).to_have_count(2)
        await page.locator('.ue-topbar-search-wrap > button').click()
        search = page.locator("#ue-topbar-search")
        await page.route("**/universal_gallery/api/library/entries?*", slow_soft)
        await search.fill("Soft")
        await asyncio.wait_for(started.wait(), 6)
        await search.fill("neverxyz")
        await asyncio.wait_for(latest_started.wait(), 6)
        await expect(page.locator(".ue-library-row")).to_have_count(0)
        release.set()
        await page.wait_for_timeout(100)
        await expect(page.locator(".ue-library-row")).to_have_count(0)
        await expect(search).to_have_value("neverxyz")
        assert query(page.url, "library") == "Demo prompts.json", page.url
        assert "Soft" in queries and "neverxyz" in queries, queries
        # During composition, no intermediate pinyin query leaves the browser.
        queries.clear()
        await search.dispatch_event("compositionstart", {"data": "n"})
        await search.fill("ni")
        await page.wait_for_timeout(390)
        assert "ni" not in queries, queries
        await search.dispatch_event("compositionend", {"data": "ni"})
        await expect(page.locator(".ue-library-row")).to_have_count(0)
        await page.wait_for_timeout(310)
        assert "ni" in queries, queries
    finally:
        release.set()
        await page.close()
    print("PASS P1-2/P1-3: out-of-order library search cannot replace latest results; IME and keyboard row")


async def detail_focus_and_history_guard(browser, errors):
    page = await gallery(browser, errors)
    try:
        opener = page.locator(".ue-gallery-card img[role='button']").first
        await opener.focus()
        await opener.click()
        modal = page.locator(".ue-modal-backdrop--lightbox")
        await expect(modal).to_be_visible()
        assert await page.evaluate("document.querySelector('#root').inert === true")
        assert await modal.evaluate("dialog => dialog.contains(document.activeElement)")
        for key in ["Tab", "Shift+Tab", "Control+a", "Tab"]:
            await page.keyboard.press(key)
            assert await modal.evaluate("dialog => dialog.contains(document.activeElement)"), key
        await expect(page.locator(".ue-gallery-inspector")).to_have_count(0)
        await page.keyboard.press("Escape")
        await expect(modal).to_have_count(0)
        await expect(opener).to_be_focused()
        assert not await page.evaluate("document.querySelector('#root').inert")

        # A browser Back that leaves a dirty detail first asks about the draft.
        await page.locator(".ue-sidebar-quick button").filter(has_text="输入图库").click()
        await expect(page.locator(".ue-gallery-state--empty h3")).to_be_visible()
        await page.go_back(wait_until="domcontentloaded")
        await expect(page.locator(".ue-gallery-card").first).to_be_visible()
        await opener.focus()
        await opener.click()
        await page.locator(".ue-lightbox-toolbar button[aria-label='显示或隐藏侧边信息']").click()
        field = page.locator(".ue-lightbox-inspector.is-open .ue-detail-form input").first
        await field.fill("P12 pending draft")
        await page.evaluate("history.forward()")
        dialog = page.get_by_role("alertdialog")
        await expect(dialog).to_be_visible()
        assert await dialog.evaluate("element => element.contains(document.activeElement)")
        await page.keyboard.press("Tab")
        assert await dialog.evaluate("element => element.contains(document.activeElement)")
        await dialog.get_by_role("button", name="取消").click()
        await expect(field).to_have_value("P12 pending draft")
        await expect(modal).to_be_visible()
        # Cancelling a pop records the protected URL as a new history entry;
        # the previous (blocked) entry is now reachable with Back.
        await page.evaluate("history.back()")
        await expect(dialog).to_be_visible()
        await dialog.get_by_role("button", name="放弃修改").click()
        await expect(page.locator(".ue-gallery-state--empty h3")).to_be_visible()
    finally:
        await page.close()
    print("PASS P1-3/P2-3: modal focus/inert/shortcuts/return, browser history protects unsaved detail")


async def settings_and_library_history_guard(browser, errors):
    page = await gallery(browser, errors)
    try:
        await switch_tab(page, 3)
        await expect(page.locator(".ue-settings-preferences")).to_be_visible()
        await page.locator(".ue-settings-source-list > button").click()
        field = page.locator(".ue-settings-form input").first
        await field.fill("P12 unsaved source")
        await page.evaluate("history.back()")
        dialog = page.get_by_role("alertdialog")
        await expect(dialog).to_be_visible()
        await dialog.get_by_role("button", name="取消").click()
        await expect(field).to_have_value("P12 unsaved source")
        await page.evaluate("history.back()")
        await expect(dialog).to_be_visible()
        await dialog.get_by_role("button", name="放弃修改").click()
        await expect(page.locator(".ue-gallery-card").first).to_be_visible()
    finally:
        await page.close()

    page = await gallery(browser, errors)
    try:
        await switch_tab(page, 1)
        await page.locator(".ue-library-main").first.click()
        await expect(page.locator(".ue-library-row")).to_have_count(2)
        await page.locator(".ue-library-actions button[aria-label='编辑 JSON']").click()
        editor = page.locator(".ue-json-editor")
        await expect(editor).to_be_visible()
        await editor.fill((await editor.input_value()) + " ")
        await page.evaluate("history.back()")
        dialog = page.get_by_role("alertdialog")
        await expect(dialog).to_be_visible()
        await dialog.get_by_role("button", name="取消").click()
        await expect(editor).to_contain_text(" ")
        await page.evaluate("history.back()")
        await expect(dialog).to_be_visible()
        await dialog.get_by_role("button", name="放弃修改").click()
        await expect(page.locator(".ue-library-row")).to_have_count(0)
        assert query(page.url, "library") == "", page.url
    finally:
        await page.close()
    print("PASS P2-3: browser Back protects unsaved settings and library JSON, with cancel/discard choices")


async def detail_scopes(browser, errors):
    page = await gallery(browser, errors)
    try:
        await open_mode(page, "开启双栏目录整理")
        right = page.locator(".ue-dual-pane").nth(1)
        await right.locator(".ue-folder-combobox-trigger").click()
        await page.get_by_role("option", name="01 · Landscapes").click()
        await expect(right.locator(".ue-dual-card")).to_have_count(6)
        filename = await right.locator(".ue-dual-card strong[title]").first.get_attribute("title")
        await right.locator(".ue-dual-card").first.click()
        await expect(page.locator(".ue-gallery-inspector")).to_contain_text("已选 1 项")
        await right.locator(".ue-dual-card").first.dblclick()
        detail = page.locator(".ue-modal-backdrop--lightbox")
        await expect(detail).to_have_attribute("aria-label", filename)
        await expect(detail.locator(".ue-lightbox-filmstrip-item")).to_have_count(6)
        await detail.locator(".ue-lightbox-side-nav--next").click()
        assert await detail.get_attribute("aria-label") != filename
        await page.keyboard.press("Escape")
        await open_mode(page, "变体")
        near_duplicate = page.locator(".ue-variant-card").filter(has_text="Near duplicate").first
        await expect(near_duplicate).to_be_visible(timeout=10_000)
        gallery_count = int(await page.locator(".ue-filter-summary strong").inner_text())
        await near_duplicate.click()
        await expect(page.locator(".ue-gallery-card").first).to_be_visible()
        variant_items = await page.locator(".ue-variant-detail-head strong").inner_text()
        await page.locator(".ue-gallery-card img[role='button']").first.click()
        await expect(detail.locator(".ue-lightbox-filmstrip-item").first).to_be_visible()
        variant_count = await detail.locator(".ue-lightbox-filmstrip-item").count()
        assert 2 <= variant_count < gallery_count, (variant_count, gallery_count)
        await detail.locator(".ue-lightbox-side-nav--next").click()
        await expect(detail.locator(".ue-lightbox-filmstrip-item.is-active")).to_have_count(1)
        await page.keyboard.press("Escape")
        await page.locator(".ue-gallery-card .ue-select-btn").first.click()
        await expect(page.locator(".ue-gallery-inspector")).to_contain_text("已选 1 项")
        assert variant_items
    finally:
        await page.close()
    print("PASS P1-4: dual right-pane and variant detail navigate only their actual lists; both feed the Inspector")


async def refresh_pagination_search_url(browser, errors):
    page = await new_page(browser, errors)
    response = await page.request.get(BASE + "/universal_gallery/api/images?page=1&limit=60&subfolder=default_output%3A%3A")
    image_page = await response.json()
    async def paged(route):
        if query(route.request.url, "search") or query(route.request.url, "subfolder") != "default_output::":
            await route.continue_()
            return
        next_page = int(query(route.request.url, "page") or "1")
        payload = dict(image_page)
        payload["total"] = 90
        payload["page"] = next_page
        payload["images"] = image_page["images"][:2] if next_page == 2 else image_page["images"]
        await route.fulfill(json=payload)
    await page.route("**/universal_gallery/api/images?*", paged)
    started, release = asyncio.Event(), asyncio.Event()
    async def slow_refresh(route):
        if query(route.request.url, "force_refresh") == "true":
            started.set()
            await asyncio.wait_for(release.wait(), 12)
        await paged(route)
    await page.unroute("**/universal_gallery/api/images?*", paged)
    await page.route("**/universal_gallery/api/images?*", slow_refresh)
    try:
        await page.reload(wait_until="networkidle")
        await expect(page.locator(".ue-gallery-card").first).to_be_visible()
        await page.locator('[data-tour-id="topbar-refresh"]').click()
        await asyncio.wait_for(started.wait(), 6)
        await expect(page.locator(".ue-operation-card--pending")).to_be_visible()
        release.set()
        await expect(page.locator(".ue-operation-card--success")).to_be_visible()
        # Pagination resets the *main scroll container*, not the window.
        await page.locator(".ue-main-shell").evaluate("element => element.scrollTop = 650")
        await page.locator(".ue-pagination-actions button[aria-label='下一页']").click()
        await expect(page.locator(".ue-gallery-card")).to_have_count(2)
        assert query(page.url, "page") == "2", page.url
        assert await page.locator(".ue-main-shell").evaluate("element => element.scrollTop") == 0
        await page.locator(".ue-gallery-card img[role='button']").first.click()
        await expect(page.locator(".ue-modal-backdrop--lightbox .ue-lightbox-filmstrip-item")).to_have_count(2)
        await page.keyboard.press("Escape")
        await page.reload(wait_until="networkidle")
        await expect(page.locator(".ue-gallery-card")).to_have_count(2)
        await page.go_back(wait_until="domcontentloaded")
        await expect(page.locator(".ue-gallery-card")).to_have_count(len(image_page["images"]))
        assert query(page.url, "page") == "", page.url

        search = page.locator(".ue-gallery-search-input")
        async with page.expect_request(lambda request: query(request.url, "search") == "neverxyz"):
            await search.fill("neverxyz")
        await expect(page.locator(".ue-gallery-state--empty h3")).to_have_text("没有符合筛选条件的图片")
        await page.wait_for_function("new URL(location.href).searchParams.get('q') === 'neverxyz'")
        await page.reload(wait_until="networkidle")
        await expect(search).to_have_value("neverxyz")
        await page.locator(".ue-gallery-state--empty button").click()
        await expect(page.locator(".ue-gallery-card").first).to_be_visible()
    finally:
        release.set()
        await page.close()
    print("PASS P2-1/2/3: refresh waits for fetch, page scroll/URL/reload/Back, filtered empty reset, debounced search URL")


async def empty_states_and_retry(browser, errors):
    async def no_sources(page):
        context = await (await page.request.get(BASE + "/universal_gallery/api/context")).json()
        context.update(sources=[], active_source_count=0, subfolders=[], move_targets=[])
        await page.route("**/universal_gallery/api/context*", lambda route: route.fulfill(json=context))
        await page.route("**/universal_gallery/api/images?*", lambda route: route.fulfill(json={
            "images": [], "total": 0, "page": 1, "limit": 60,
        }))
    page = await new_page(browser, errors, before=no_sources)
    try:
        await expect(page.locator(".ue-gallery-state--empty h3")).to_have_text("暂无可用图源")
        await page.locator(".ue-gallery-state--empty button").click()
        await expect(page.locator(".ue-settings-preferences")).to_be_visible()
    finally:
        await page.close()

    failures = []
    async def fail_initial(page):
        async def respond(route):
            failures.append(route.request.url)
            if len(failures) == 1:
                await route.fulfill(status=500, json={"error": "P12 injected image load error"})
            else:
                await route.continue_()
        await page.route("**/universal_gallery/api/images?*", respond)
    page = await new_page(browser, errors, before=fail_initial)
    try:
        await expect(page.locator(".ue-gallery-state--empty h3")).to_have_text("图库加载失败")
        await expect(page.locator(".ue-gallery-state--empty")).to_contain_text("P12 injected image load error")
        await page.locator(".ue-gallery-state--empty button").click()
        await expect(page.locator(".ue-gallery-card").first).to_be_visible()
        assert len(failures) >= 2
    finally:
        await page.close()
    print("PASS P2-1: no-source action opens settings; failed image request offers a working retry")


async def background_refresh_and_inspector_layout(browser, errors):
    async def changed_freshness(page):
        await page.route("**/universal_gallery/api/images/freshness?*", lambda route: route.fulfill(json={
            "changed": True, "fingerprint": "p12-updated", "total": 19,
            "latest_relative_path": "new-image.png", "checked_at": 1, "subfolder": "default_output::",
        }))
    page = await gallery(browser, errors, live=True, before=changed_freshness)
    try:
        first_name = await page.locator(".ue-gallery-card img[role='button']").first.get_attribute("alt")
        await page.locator(".ue-main-shell").evaluate("element => element.scrollTop = 450")
        assert await page.locator(".ue-main-shell").evaluate("element => element.scrollTop") > 80
        await expect(page.locator(".ue-live-refresh-pill")).to_be_visible(timeout=10_000)
        assert await page.locator(".ue-main-shell").evaluate("element => element.scrollTop") > 80
        assert await page.locator(".ue-gallery-card img[role='button']").first.get_attribute("alt") == first_name
        await page.locator(".ue-live-refresh-pill").click()
        await expect(page.locator(".ue-live-refresh-pill")).to_have_count(0)
    finally:
        await page.close()

    for width in [960, 1280]:
        page = await gallery(browser, errors, width=width)
        try:
            await page.locator(".ue-gallery-card .ue-select-btn").first.click()
            await expect(page.locator(".ue-gallery-inspector")).to_be_visible()
            assert await page.locator(".ue-gallery-card").first.is_visible()
            layout = await page.evaluate("""() => {
              const main = document.querySelector('.ue-main-shell').getBoundingClientRect();
              const inspector = document.querySelector('.ue-gallery-inspector-layer').getBoundingClientRect();
              const card = document.querySelector('.ue-gallery-card').getBoundingClientRect();
              return {main:{right:main.right,bottom:main.bottom}, inspector:{left:inspector.left,top:inspector.top,right:inspector.right},
                card:{right:card.right,bottom:card.bottom}, overflow:document.documentElement.scrollWidth > innerWidth};
            }""")
            assert not layout["overflow"], (width, layout)
            assert layout["inspector"]["right"] <= width + 2, (width, layout)
            if width > 960:
                assert layout["main"]["right"] <= layout["inspector"]["left"] + 2, (width, layout)
            else:
                assert layout["main"]["bottom"] <= layout["inspector"]["top"] + 2, (width, layout)
        finally:
            await page.close()
    print("PASS P2-2/5: scrolled live additions show a non-disruptive notice; 960/1280px Inspector leaves usable space")


async def mobile_density(browser, errors):
    page = await gallery(browser, errors, width=390)
    try:
        trigger = page.get_by_role("button", name="网格密度")
        await trigger.click()
        panel = page.get_by_role("dialog", name="网格密度")
        await expect(panel.locator(".ue-density-note")).to_contain_text("当前实际每行 1 列")
        await panel.get_by_role("button", name="紧凑双列").click()
        await expect(panel.locator(".ue-density-note")).to_contain_text("当前实际每行 2 列")
        assert await page.locator(".ue-gallery-card").first.evaluate("element => element.getAttribute('data-lane')") == "0"
        assert await page.locator(".ue-gallery-card[data-lane='1']").count() > 0
        for label in ["舒适单列", "紧凑双列", "列表"]:
            box = await panel.get_by_role("button", name=label).bounding_box()
            assert box and box["height"] >= 44, (label, box)
        await panel.get_by_role("button", name="列表").click()
        await expect(page.locator(".ue-gallery-list-row").first).to_be_visible()
        assert not await page.evaluate("document.documentElement.scrollWidth > innerWidth")
    finally:
        await page.close()
    print("PASS P2-4: 390px effective single/double columns, 44px touch targets, list, no overflow")


async def import_target(browser, errors):
    page = await gallery(browser, errors)
    try:
        await page.locator(".ue-toolbar-more > summary").click()
        target = page.get_by_role("combobox", name="导入目标")
        await expect(target.locator("option:checked")).to_contain_text("ComfyUI Output / universal_gallery_imports/")
        # A File is assembled from the preview's own sample; never touches real user files.
        filename = f"P12-browser-import-{time.time_ns()}.png"
        await page.evaluate("""async (name) => {
          const url = document.querySelector('.ue-gallery-card img').src;
          const blob = await (await fetch(url)).blob();
          const transfer = new DataTransfer();
          transfer.items.add(new File([blob], name, {type:'image/png'}));
          document.querySelector('.ue-drop-shell').dispatchEvent(new DragEvent('drop', {bubbles:true, dataTransfer:transfer}));
        }""", filename)
        dialog = page.get_by_role("alertdialog")
        await expect(dialog).to_contain_text("ComfyUI Output / universal_gallery_imports/")
        await dialog.get_by_role("button", name="导入", exact=True).click()
        await expect(page.locator(".ue-inline-success")).to_contain_text("universal_gallery_imports/")
        await page.get_by_role("button", name="打开导入目录").click()
        assert query(page.url, "folder") == "default_output::universal_gallery_imports", page.url
        await expect(page.locator(f".ue-gallery-card img[alt='{filename}']")).to_be_visible()
    finally:
        await page.close()
    print("PASS P1-5: selector and preflight disclose subfolder; real isolated import links to server-returned directory")


async def main():
    errors = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(args=["--no-sandbox"])
        try:
            for case in [slow_source_and_empty, library_race_and_ime, detail_focus_and_history_guard,
                         settings_and_library_history_guard, detail_scopes, refresh_pagination_search_url, empty_states_and_retry,
                         background_refresh_and_inspector_layout, mobile_density, import_target]:
                await case(browser, errors)
            assert not errors, errors
        finally:
            await browser.close()
    print("PASS P1/P2 browser regression: 10 isolated scenarios; no page errors; one temporary demo import")


if __name__ == "__main__":
    asyncio.run(main())
