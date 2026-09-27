"""Real-browser regression for the virtual masonry grid at the last images.

Build first and run `python scripts/preview.py --host 0.0.0.0 --port 8189`.
Then run `python scripts/browser_masonry.py http://127.0.0.1:8189`.
The 48 varied-height images are served by an intercepted list API; the underlying
thumbnails come from the isolated preview, not a user's ComfyUI installation.
"""
from __future__ import annotations

import asyncio
import sys
from collections import defaultdict
from urllib.parse import parse_qs, urlsplit

from playwright.async_api import async_playwright, expect

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8189"
COUNT = 48


async def synthetic_page(browser, width: int, *, profile: str = "mixed", mobile_density: str = "single"):
    page = await browser.new_page(viewport={"width": width, "height": 800}, reduced_motion="reduce")
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    assert mobile_density in {"single", "double"}
    await page.add_init_script("""
      localStorage.setItem('universal-extractor-locale','zh-CN');
      localStorage.setItem('universal-extractor:onboarding-tour-v1-completed','true');
      localStorage.setItem('universal-extractor:mobile-density', '__DENSITY__');
      localStorage.setItem('universal-extractor:ui-preferences',JSON.stringify({
        enableImagePrefetch:false,enableLiveGalleryRefresh:false
      }));
    """.replace("__DENSITY__", mobile_density))
    response = await page.request.get(BASE + "/universal_gallery/api/images?page=1&limit=48&subfolder=default_output%3A%3A")
    fixture = await response.json()
    assert len(fixture["images"]) >= 12
    original = fixture["images"]
    images = []
    for index in range(COUNT):
        item = dict(original[index % len(original)])
        item["relative_path"] = f"synthetic/virtual_{index:03}.png"
        item["filename"] = f"virtual_{index:03}.png"
        if profile == "right-heavy":
            # Tall cards in the first three lanes make the rightmost lane
            # accumulate multiple extra short cards before the other lanes.
            dimensions = (600, 3000) if index < 3 else ((600, 960) if index % 7 == 0 else (1100, 340))
        elif profile == "extreme":
            dimensions = [(600, 2500), (1600, 200), (600, 840), (0, 0), (600, 440)][index % 5]
        else:
            dimensions = [(600, 980), (1100, 340), (600, 820) if profile == "known" else (0, 0),
                          (600, 780), (600, 420)][index % 5]
        item["width"], item["height"] = dimensions
        item["category"] = "Long category name with wrap" if index % 4 == 0 else ""
        item["title"] = "A rather long title for a variable masonry row" if index % 3 == 0 else ""
        # A unique URL prevents the first screen's already-loaded thumbnails
        # from masking lazy decoding of cards approached near the bottom.
        item["thumb_url"] += f"&masonry_fixture={index:03}"
        images.append(item)
    fixture.update(images=images, page=1, limit=COUNT, total=COUNT)

    async def images_api(route):
        if parse_qs(urlsplit(route.request.url).query).get("page", ["1"])[0] == "1":
            await route.fulfill(json=fixture)
        else:
            await route.continue_()

    async def delayed_thumb(route):
        await asyncio.sleep(.32)
        await route.continue_()

    await page.route("**/universal_gallery/api/images?*", images_api)
    await page.route("**/universal_gallery/api/thumb?*", delayed_thumb)
    await page.goto(BASE + "/gallery/", wait_until="networkidle")
    await expect(page.locator(".ue-gallery-card").first).to_be_visible()
    return page, errors


async def read_layout(page):
    return await page.evaluate("""() => {
      const main=document.querySelector('.ue-main-shell');
      const grid=document.querySelector('.ue-gallery-grid--virtual');
      const cards=[...grid.querySelectorAll('.ue-gallery-card')].map(n=>({
        index:Number(n.dataset.index),lane:Number(n.dataset.lane),
        top:n.offsetTop,height:n.offsetHeight,
        mediaHeight:n.querySelector('.ue-gallery-media').offsetHeight,
        imageLoaded:n.querySelector('img')?.complete || false,
        contentVisibility:getComputedStyle(n).contentVisibility
      }));
      return {
        scroll:main.scrollTop,max:main.scrollHeight-main.clientHeight,
        height:grid.getBoundingClientRect().height,
        gridOffset:grid.getBoundingClientRect().top-main.getBoundingClientRect().top+main.scrollTop,
        cards
      };
    }""")


def validate_cards(layout):
    per_lane = defaultdict(list)
    for card in layout["cards"]:
        assert card["contentVisibility"] == "visible", ("offscreen measurement is not trustworthy", card)
        per_lane[card["lane"]].append(card)
    for lane, cards in per_lane.items():
        cards.sort(key=lambda card: card["top"])
        for previous, current in zip(cards, cards[1:]):
            assert current["top"] >= previous["top"] + previous["height"] + 13, (
                "overlapping masonry cards", lane, previous, current)
    assert layout["height"] >= max(c["top"] + c["height"] for c in layout["cards"]) - 2


async def near_bottom_wheel(page):
    main = page.locator(".ue-main-shell")
    await main.evaluate("n => n.scrollTop = n.scrollHeight - n.clientHeight - 600")
    await page.wait_for_timeout(160)
    bounds = await main.bounding_box()
    assert bounds
    await page.mouse.move(bounds["x"] + bounds["width"] / 2, bounds["y"] + bounds["height"] / 2)
    first = await read_layout(page)
    assert first["max"] - first["scroll"] >= 80, first
    validate_cards(first)
    samples = [first]
    directions = [190, 180, 180, -140, 120, -95, 140, 175, -145, 210, -120, 190]
    for direction in directions:
        await page.mouse.wheel(0, direction)
        await page.wait_for_timeout(75)
        sample = await read_layout(page)
        samples.append(sample)
        validate_cards(sample)
    for _ in range(4):
        await page.wait_for_timeout(100)
        samples.append(await read_layout(page))
    heights = [sample["height"] for sample in samples]
    assert max(heights) - min(heights) <= 2, ("changing scroll range without a resize", heights)
    for previous, current, direction in zip(samples, samples[1:], directions):
        expected = max(0, min(current["max"], previous["scroll"] + direction))
        assert abs(current["scroll"] - expected) <= 3, (
            "wheel movement was overridden by a measurement/anchor correction", direction,
            previous["scroll"], current["scroll"], expected)
    assert COUNT - 1 in {c["index"] for c in samples[-1]["cards"]}, "last card disappeared"
    return max(heights) - min(heights)


async def scan_all_cards(page):
    main = page.locator(".ue-main-shell")
    seen: dict[int, int] = {}
    for step in range(16):
        await main.evaluate("(n,step)=>{n.scrollTop=step*(n.scrollHeight-n.clientHeight)/15}", step)
        await page.wait_for_timeout(85)
        layout = await read_layout(page)
        validate_cards(layout)
        seen.update({card["index"]: card["lane"] for card in layout["cards"]})
    assert set(seen) == set(range(COUNT)), ("missing cards during travel", sorted(set(range(COUNT)) - set(seen)))
    bottom = await read_layout(page)
    assert bottom["max"] - bottom["scroll"] <= 2
    assert COUNT - 1 in {c["index"] for c in bottom["cards"]}
    assert abs(bottom["height"] - max(c["top"] + c["height"] for c in bottom["cards"])) <= 2, (
        "grid height disagrees with its bottommost actual card", bottom["height"], bottom["cards"][-5:])
    return seen


async def wheel_full(page):
    main = page.locator(".ue-main-shell")
    await main.evaluate("n=>n.scrollTop=0")
    await page.wait_for_timeout(140)
    bounds = await main.bounding_box()
    assert bounds
    await page.mouse.move(bounds["x"] + bounds["width"] / 2, bounds["y"] + bounds["height"] / 2)
    count = 0
    for direction in (190, -190):
        for _ in range(110):
            previous = await read_layout(page)
            if (direction > 0 and previous["max"] - previous["scroll"] < 3) or (direction < 0 and previous["scroll"] < 3):
                break
            await page.mouse.wheel(0, direction)
            await page.wait_for_timeout(55)
            current = await read_layout(page)
            expected = max(0, min(current["max"], previous["scroll"] + direction))
            assert abs(current["scroll"] - expected) <= 3, (
                "full-scroll wheel correction", direction, previous["scroll"], current["scroll"], expected)
            count += 1
        else:
            raise AssertionError("full scroll did not reach the boundary")
    assert count >= 12, count
    return count


async def resize_same_lanes(browser, start_width, end_width, mobile_density="single"):
    page, errors = await synthetic_page(browser, start_width, mobile_density=mobile_density)
    try:
        main = page.locator(".ue-main-shell")
        await main.evaluate("n=>n.scrollTop=n.scrollHeight")
        await page.wait_for_timeout(180)
        before = await read_layout(page)
        await page.set_viewport_size({"width": end_width, "height": 800})
        await page.wait_for_timeout(430)
        resized = await read_layout(page)
        await main.evaluate("n=>n.scrollTop=0")
        await page.wait_for_timeout(240)
        revisited = await read_layout(page)
        # Reset old-width measurements, then measure real visible cards. A few
        # multiline category chips may account for a small residual change.
        assert abs(revisited["height"] - resized["height"]) <= 55, (
            "stale offscreen card sizes after width change", start_width, end_width,
            resized["height"], revisited["height"])
        await near_bottom_wheel(page)
        assert before["height"] != resized["height"], "responsive layout was not remeasured"
        assert not errors, errors
        print(f"PASS resize {start_width}->{end_width}: width changed, offscreen heights invalidated, bottom wheel stable")
    finally:
        await page.close()


async def resize_lane_count(browser, start_width, end_width, expected_lanes):
    page, errors = await synthetic_page(browser, start_width, mobile_density="double")
    try:
        main = page.locator(".ue-main-shell")
        await main.evaluate("n=>n.scrollTop=n.scrollHeight")
        await page.wait_for_timeout(180)
        await page.set_viewport_size({"width": end_width, "height": 800})
        await page.wait_for_timeout(360)
        await near_bottom_wheel(page)
        lanes = await scan_all_cards(page)
        assert len(set(lanes.values())) == expected_lanes, (start_width, end_width, set(lanes.values()))
        assert not errors, errors
        print(f"PASS resize {start_width}->{end_width}: {expected_lanes} lanes, no lost or overlapping cards, bottom wheel stable")
    finally:
        await page.close()


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        try:
            for width, profile, density in [
                (390, "mixed", "single"), (390, "mixed", "double"),
                (960, "mixed", "single"), (1280, "mixed", "single"),
                (1440, "mixed", "single"), (1440, "right-heavy", "single"),
                (960, "extreme", "single"),
            ]:
                page, errors = await synthetic_page(browser, width, profile=profile, mobile_density=density)
                try:
                    height_change = await near_bottom_wheel(page)
                    # Traverse with actual wheel events before any scan pre-measures
                    # the middle of the list; this exercises asynchronous RO work.
                    if (width, profile, density) in [(390, "mixed", "double"), (1440, "mixed", "single")]:
                        steps = await wheel_full(page)
                    else:
                        steps = 0
                    lanes = await scan_all_cards(page)
                    if profile == "right-heavy":
                        counts = [list(lanes.values()).count(lane) for lane in range(4)]
                        assert counts[3] >= max(counts[:3]) + 2, ("not a right-heavy fixture", counts)
                    assert not errors, errors
                    print(f"PASS width={width} profile={profile} mobile_density={density}: "
                          f"48 cards, {len(set(lanes.values()))} columns, bottom range drift={height_change:.1f}px, "
                          f"wheel traversal={steps} steps")
                finally:
                    await page.close()
            for start_width, end_width, density in [
                (1280, 1440, "single"), (960, 900, "single"), (390, 550, "single")
            ]:
                await resize_same_lanes(browser, start_width, end_width, density)
            await resize_lane_count(browser, 390, 960, 4)
            await resize_lane_count(browser, 960, 390, 2)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
