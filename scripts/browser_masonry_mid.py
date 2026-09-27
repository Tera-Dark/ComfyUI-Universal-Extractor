"""Real-browser middle-of-gallery bidirectional wheel regression.

After `npm run build` and `python scripts/preview.py --port 8189`, run
`python scripts/browser_masonry_mid.py http://127.0.0.1:8189`.
Checks image visibility/identity, scroll movement and card coordinates on many
mid-gallery reversals, not just when approaching the end of the list.
"""
from __future__ import annotations

import asyncio
import os
import sys

DEBUG = bool(os.environ.get("MASONRY_MID_DEBUG"))

from playwright.async_api import async_playwright

import browser_masonry as fixture

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8189"
fixture.BASE = BASE
fixture.COUNT = 160


def assert_stable(previous, current, direction):
    expected = max(0, min(current["max"], previous["scroll"] + direction))
    assert abs(current["scroll"] - expected) <= 3, (
        "scroll anchor correction", direction, previous["scroll"], current["scroll"], expected)
    assert abs(current["height"] - previous["height"]) <= 2, (
        "masonry total height jumped mid-scroll", previous["height"], current["height"])
    if current["hovered"] is not None:
        assert current["hoverTransform"] in {"none", "matrix(1, 0, 0, 1, 0, 0)"}, (
            "scrolling over a photo translated the hovered card", current["hovered"], current["hoverTransform"])
    shared = set(previous["positions"]) & set(current["positions"])
    # Cards that remain mounted should move only by the distance the container
    # scrolls. Their layout top must not change when RO measures other cards.
    moved = {key: round(current["positions"][key] - previous["positions"][key], 2)
             for key in shared if abs(current["positions"][key] - previous["positions"][key]) > 2}
    assert not moved, ("visible masonry cards changed layout position", direction, moved)
    return len(shared)


async def run_case(browser, profile: str, *, width: int = 1440):
    page, errors = await fixture.synthetic_page(browser, width, profile=profile)
    try:
        main = page.locator(".ue-main-shell")
        await main.evaluate("n => n.scrollTop = n.scrollHeight * 0.45")
        await page.wait_for_timeout(360)
        await page.evaluate("""() => {
          const main = document.querySelector('.ue-main-shell');
          const grid = document.querySelector('.ue-gallery-grid--virtual');
          window.__midGalleryEvents = [];
          const observe = new MutationObserver((records) => {
            for (const record of records) {
              for (const [nodes, op] of [[record.addedNodes,'add'],[record.removedNodes,'remove']]) {
                for (const node of nodes) {
                  if (node.nodeType !== 1) continue;
                  const card = node.classList.contains('ue-gallery-card') ? node : node.closest('.ue-gallery-card');
                  if (!card) continue;
                  const rect = card.getBoundingClientRect();
                  const bounds = main.getBoundingClientRect();
                  if (rect.bottom >= bounds.top && rect.top <= bounds.bottom) {
                    window.__midGalleryEvents.push([op, Number(card.dataset.index), main.scrollTop]);
                  }
                }
              }
            }
          });
          observe.observe(grid,{childList:true,subtree:true});
          window.__midGalleryObserver = observe;
        }""")
        async def sample():
            return await page.evaluate("""() => {
              const main = document.querySelector('.ue-main-shell');
              const grid = document.querySelector('.ue-gallery-grid--virtual');
              const bounds = main.getBoundingClientRect();
              const cards = [...grid.querySelectorAll('.ue-gallery-card')].filter(card => {
                const r=card.getBoundingClientRect();
                return r.top >= bounds.top - 10 && r.bottom <= bounds.bottom + 10;
              });
              const images = cards.map(card => ({
                index: Number(card.dataset.index), img:card.querySelector('img')?.complete || false,
                natural:card.querySelector('img')?.naturalWidth || 0,
                loaded:card.querySelector('.ue-gallery-image-shell')?.classList.contains('is-loaded'),
                opacity:card.querySelector('img') ? Number(getComputedStyle(card.querySelector('img')).opacity) : 0,
              }));
              const hovered=cards.find(card=>card.matches(':hover'));
              return {scroll: main.scrollTop, max:main.scrollHeight-main.clientHeight,
                  height:grid.offsetHeight, columns:Math.max(...cards.map(c=>Number(c.dataset.lane)))+1,
                  hovered: hovered ? Number(hovered.dataset.index) : null,
                  hoverTransform: hovered ? getComputedStyle(hovered).transform : 'none',
                  positions:Object.fromEntries(cards.map(c=>[c.dataset.index,c.offsetTop])), images};
            }""")
        bounds = await main.bounding_box()
        assert bounds
        await page.mouse.move(bounds["x"] + bounds["width"] * .51, bounds["y"] + bounds["height"] * .53)
        before = await sample()
        seen_loaded: set[int] = {item["index"] for item in before["images"] if item["loaded"] and item["natural"] > 0}
        shared_count = 0
        min_scroll = before["max"] * .30
        max_scroll = before["max"] * .70
        assert min_scroll < before["scroll"] < max_scroll, before
        for index in range(90):
            # A seeded sawtooth that repeatedly crosses virtual render edges.
            direction = (140, -115, 200, -210, 180, -145, -155, 220)[index % 8]
            if not min_scroll < before["scroll"] + direction < max_scroll:
                direction *= -1
            await page.mouse.wheel(0, direction)
            await page.wait_for_timeout(55)
            after = await sample()
            try:
                shared_count += assert_stable(before, after, direction)
            except AssertionError as error:
                if not DEBUG:
                    raise
                print(f"DIAGNOSTIC step={index}: {error}", flush=True)
            previous = {item["index"]: item for item in before["images"]}
            for image in after["images"]:
                old = previous.get(image["index"])
                if old and old["loaded"] and old["natural"] > 0:
                    assert image["natural"] > 0, ("previously visible image flashed blank", image, old)
                if image["index"] in seen_loaded:
                    assert image["natural"] > 0 and image["loaded"], (
                        "previously loaded photo became blank on revisit", image, index)
                if image["loaded"] and image["natural"] > 0:
                    seen_loaded.add(image["index"])
            before = after
        # Cover a larger part of the MIDDLE in both directions: cards leave
        # the virtual overscan, unmount, and later re-enter from cache.
        wide_steps = 0
        if profile == "mixed":
            for ratio in (.70, .30, .65, .40):
                target = before["max"] * ratio
                while abs(before["scroll"] - target) > 130:
                    direction = 175 if before["scroll"] < target else -175
                    await page.mouse.wheel(0, direction)
                    await page.wait_for_timeout(55)
                    after = await sample()
                    assert_stable(before, after, direction)
                    for image in after["images"]:
                        if image["index"] in seen_loaded:
                            assert image["natural"] > 0 and image["loaded"], (
                                "revisited photo showed a blank placeholder", image, wide_steps)
                        if image["loaded"] and image["natural"] > 0:
                            seen_loaded.add(image["index"])
                    before = after
                    wide_steps += 1
                    assert wide_steps < 160, "middle travel did not reach the intended points"
        for _ in range(6):
            await page.wait_for_timeout(100)
            after = await sample()
            assert_stable(before, after, 0)
            before = after
        events = await page.evaluate("window.__midGalleryEvents")
        blink = [event for event in events if event[0] == "remove"]
        if DEBUG:
            print(f"DIAGNOSTIC visible-card removals={len(blink)}: {blink[:12]}, page errors={errors}")
        else:
            assert not blink, ("visible cards were unmounted while scrolling in middle", blink[:12])
            assert not errors, errors
        print(f"PASS middle profile={profile}, width={width}, columns={before['columns']}, "
              f"90 reversals + {wide_steps} wide middle steps, "
              f"{shared_count} stable overlapping cards, {len(events)} visible DOM changes")
    finally:
        await page.close()


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        try:
            for profile in ("mixed", "extreme", "right-heavy"):
                await run_case(browser, profile)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
