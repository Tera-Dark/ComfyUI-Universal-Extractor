"""Optional real-browser smoke test against scripts/preview.py (no inference).
Requires: pip install playwright; python -m playwright install --with-deps chromium
Usage: python scripts/browser_smoke.py --url http://127.0.0.1:8189 --screenshots /tmp/ue-shots
"""
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:8189")
parser.add_argument("--screenshots", type=Path)
args = parser.parse_args()
if args.screenshots:
    args.screenshots.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(args=["--no-sandbox"])
    errors = []
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("localStorage.setItem('universal-extractor:onboarding-tour-v1-completed','true')")
    page.goto(args.url + "/gallery/", wait_until="networkidle")
    expect(page.locator(".ue-gallery-card").first).to_be_visible()
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    if args.screenshots:
        page.screenshot(path=str(args.screenshots / "desktop.png"))

    page.locator('summary[aria-label="更多操作"]').click()
    expect(page.get_by_role("button", name="开启双栏目录整理")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator(".ue-toolbar-more")).not_to_have_attribute("open", "")

    search = page.locator(".ue-gallery-search-input")
    search.fill("Study_001")
    expect(page.locator(".ue-gallery-card")).to_have_count(1)
    search.fill("")
    expect(page.locator(".ue-gallery-card")).to_have_count(18)
    page.get_by_role("button", name="列表", exact=True).click()
    expect(page.get_by_role("button", name="列表", exact=True)).to_have_attribute("aria-pressed", "true")
    page.get_by_role("button", name="网格", exact=True).click()

    for title in ["词库", "工作台", "设置", "图库"]:
        page.locator('summary[aria-label="切换工作区"]').click()
        page.get_by_role("button", name=title, exact=True).click()
        expect(page.locator(".ue-workspace-switcher > summary")).to_contain_text(title)
        if title == "词库":
            expect(page.get_by_text("Demo prompts.json").first).to_be_visible()
        if title == "工作台":
            expect(page.locator(".ue-workspace--workbench")).to_be_visible()
        if title == "设置":
            expect(page.locator(".ue-settings-workspace, .ue-settings-panel, .ue-settings-layout").first).to_be_visible()
    expect(page.locator(".ue-gallery-card").first).to_be_visible()

    # Open an actual image detail, then dismiss with its visible close control.
    page.locator(".ue-gallery-card img").first.click()
    expect(page.locator(".ue-lightbox-shell")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator(".ue-lightbox-shell")).to_have_count(0)

    mobile = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    mobile.on("pageerror", lambda error: errors.append(str(error)))
    mobile.add_init_script("localStorage.setItem('universal-extractor:onboarding-tour-v1-completed','true')")
    mobile.goto(args.url + "/gallery/", wait_until="networkidle")
    expect(mobile.locator(".ue-sidebar")).to_have_attribute("inert", "")
    expect(mobile.locator(".ue-gallery-card").first).to_be_visible()
    assert not mobile.evaluate("document.documentElement.scrollWidth > innerWidth")
    mobile.locator('[data-tour-id="topbar-sidebar-toggle"]').click()
    expect(mobile.locator(".ue-mobile-sidebar-close")).to_be_visible()
    mobile.locator(".ue-mobile-sidebar-close").click()
    expect(mobile.locator(".ue-sidebar")).to_have_attribute("inert", "")
    mobile.screenshot(path=str(args.screenshots / "mobile.png") if args.screenshots else None, animations="disabled")
    box = mobile.locator(".ue-sidebar").bounding_box()
    assert box and box["x"] + box["width"] <= 1, box
    assert not errors, errors
    browser.close()
print("PASS: desktop/mobile layout, menus, search, view mode, workspaces, image detail, sidebar; no page errors")
