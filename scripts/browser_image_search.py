"""Reverse image search browser regression against scripts/preview.py only."""
import io
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8196"
with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    context = browser.new_context(viewport={"width": 1440, "height": 960}, permissions=["clipboard-read", "clipboard-write"])
    page = context.new_page()
    errors, imports = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: imports.append(request.url) if request.url.endswith("/api/import") else None)
    page.add_init_script("localStorage.setItem('universal-extractor:onboarding-tour-v1-completed', 'true')")
    page.goto(base + "/gallery/", wait_until="networkidle")
    images = page.request.get(base + "/universal_gallery/api/images").json()["images"]
    original = next(item for item in images if item["filename"] == "Study_001.png")
    payload = page.request.get(base + original["original_url"]).body()
    page.get_by_role("button", name="以图搜图", exact=True).click()
    dialog = page.get_by_role("dialog", name="以图搜图")
    expect(dialog).to_be_visible()
    dialog.locator('input[type="file"]').set_input_files({"name": "social-original.png", "mimeType": "image/png", "buffer": payload})
    expect(dialog.get_by_text("文件完全相同", exact=True).first).to_be_visible(timeout=30000)
    expect(dialog.get_by_text("已检索 18 / 18 张", exact=False)).to_be_visible(timeout=30000)
    first = dialog.locator(".ue-image-search-result").first
    expect(first).to_contain_text("Study_001.png")
    first.get_by_role("button", name="复制完整路径").click()
    assert page.evaluate("navigator.clipboard.readText()").endswith("Study_001.png")
    shots = Path("artifacts/image-search")
    shots.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(shots / "exact-desktop.png"), animations="disabled")
    # Compression/resize emulates a platform-downloaded copy without metadata.
    with Image.open(io.BytesIO(payload)) as image:
        jpeg = io.BytesIO()
        image.resize((180, 228)).convert("RGB").save(jpeg, "JPEG", quality=45)
    (shots / "social-compressed.jpg").write_bytes(jpeg.getvalue())
    dialog.locator('input[type="file"]').set_input_files({"name": "social-compressed.jpg", "mimeType": "image/jpeg", "buffer": jpeg.getvalue()})
    expect(dialog.get_by_text("正在查找相同和相似图片…")).not_to_be_visible(timeout=10000)
    expect(dialog.locator(".ue-image-search-result").first).to_contain_text("Study_001.png")
    expect(dialog.locator(".ue-image-search-match").first).to_contain_text("视觉匹配分")
    page.screenshot(path=str(shots / "compressed-desktop.png"), animations="disabled")
    dialog.locator(".ue-image-search-result").first.get_by_role("button", name="定位文件夹").click()
    expect(dialog).not_to_be_visible()
    expect(page.locator(".ue-gallery-card")).to_have_count(1)
    expect(page.locator(".ue-gallery-search-input")).to_have_value("Study_001.png")
    # Real clipboard image -> global Ctrl+V -> search, never import.
    page.evaluate("""async url => {
      const blob = await (await fetch(url)).blob();
      await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
    }""", original["original_url"])
    page.locator(".ue-filter-kicker").click()
    page.keyboard.press("Control+v")
    expect(dialog).to_be_visible()
    # Native clipboard transfers pixels and may re-encode PNG/remove metadata.
    expect(dialog.locator(".ue-image-search-result").first).to_contain_text("Study_001.png", timeout=10000)
    # Mobile result paths and actions stay inside the viewport.
    page.set_viewport_size({"width": 390, "height": 844})
    assert dialog.evaluate("node => node.scrollWidth <= node.clientWidth + 1")
    page.screenshot(path=str(shots / "mobile.png"), animations="disabled")
    page.keyboard.press("Escape")
    expect(dialog).not_to_be_visible()
    assert imports == [], imports
    assert errors == [], errors
    print("PASS: exact, compressed/resized, full path copy, folder locate, real clipboard paste, mobile, no import, no JS errors")
    browser.close()
