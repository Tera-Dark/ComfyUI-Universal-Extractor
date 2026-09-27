"""RC2 interaction checks against isolated scripts/preview.py, not a real ComfyUI host.
Usage: python scripts/browser_rc2.py [base_url] [evidence_dir]
"""
import asyncio
import json
import sys
from pathlib import Path
from playwright.async_api import async_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8189'
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / 'artifacts' / 'rc2-evidence')
OUT.mkdir(parents=True, exist_ok=True)


def overlap(a, b):
    return max(0, min(a['x']+a['width'],b['x']+b['width'])-max(a['x'],b['x'])) * max(0,min(a['y']+a['height'],b['y']+b['height'])-max(a['y'],b['y']))


async def main():
    report = {'environment':'Isolated preview backend + Chromium; no real ComfyUI/GPU', 'tours':[], 'errors':[]}
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for width,height in [(1440,960),(768,1024),(390,844),(320,568)]:
            for locale in ['en','zh-CN']:
                context = await browser.new_context(viewport={'width':width,'height':height}, reduced_motion='reduce' if width==320 else 'no-preference')
                await context.add_init_script(f'localStorage.setItem("universal-extractor-locale",{json.dumps(locale)})')
                page = await context.new_page()
                page.on('pageerror', lambda e:report['errors'].append(str(e)))
                await page.goto(BASE+'/gallery/',wait_until='domcontentloaded')
                tour = page.locator('.ue-onboarding-card')
                await expect(tour).to_be_visible()
                await expect(page.locator('html')).to_have_attribute('lang',locale)
                print('CASE',width,height,locale,flush=True)
                case={'width':width,'height':height,'locale':locale,'steps':[]}
                for index in range(11):
                    await expect(tour).to_have_attribute('data-step',['welcome','topbar','sidebar','gallery','density','selection','detail','library','workbench','settings','done'][index])
                    if index not in (0,10):
                        highlight = page.locator('.ue-onboarding-highlight')
                        await expect(highlight).to_be_visible(timeout=10000)
                    await page.wait_for_timeout(350)
                    box=await tour.bounding_box()
                    assert box and box['x']>=0 and box['y']>=0 and box['x']+box['width']<=width+1 and box['y']+box['height']<=height+1,(case,index,box)
                    assert await tour.evaluate('(e)=>e.contains(document.activeElement)'), ('focus escaped',width,locale,index)
                    assert await page.locator('#root').evaluate('(e)=>e.inert')
                    color=await page.locator('.ue-tour-next').evaluate('(e)=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor})')
                    assert color['fg']=='rgb(255, 255, 255)' and color['bg'] in ('rgb(33, 33, 33)','rgb(58, 58, 58)'),color
                    if index not in (0,10):
                        target=await highlight.bounding_box()
                        assert overlap(box,target)<=1,('card overlaps target',case,index,box,target)
                    case['steps'].append({'index':index,'card':box})
                    if width in (1440,390) and locale=='zh-CN' and index in (1,4,6):
                        await page.screenshot(animations='disabled',path=str(OUT/f'tour-{width}-step-{index}.png'))
                    if index==0:
                        # Modal keyboard loop in both directions.
                        await page.locator('.ue-tour-next').focus()
                        await page.keyboard.press('Tab')
                        assert await tour.evaluate('(e)=>e.contains(document.activeElement)')
                        await page.keyboard.press('Shift+Tab')
                    await page.locator('.ue-tour-next').click()
                await expect(tour).to_have_count(0)
                assert not await page.locator('#root').evaluate('(e)=>e.inert')
                report['tours'].append(case)
                # Menu text must remain visible at mobile sizes, not just accessible via title.
                await page.locator('[data-tour-id="workspace-switcher"]').click()
                menu=page.locator('.ue-workspace-switcher .ue-disclosure-panel')
                await expect(menu).to_be_visible()
                assert await menu.locator('small').count()==4
                for description in await menu.locator('small').all():
                    await expect(description).to_be_visible()
                    assert (await description.inner_text()).strip()
                if width in (1440,390) and locale=='zh-CN':
                    await page.screenshot(animations='disabled',path=str(OUT/f'workspace-menu-{width}.png'))
                await menu.locator('button').first.click()
                await expect(page.locator('.ue-gallery-card').first).to_be_visible()
                density=page.locator('[data-tour-id="gallery-density"]')
                await density.click()
                panel=page.locator('.ue-density-panel')
                await expect(panel).to_be_visible()
                pb=await panel.bounding_box()
                assert pb['x']>=0 and pb['x']+pb['width']<=width+1
                if width <= 560:
                    # P2 uses explicit touch-friendly mobile presets in place of
                    # the desktop 3–8 column range; report effective, not requested, columns.
                    presets = panel.locator('.ue-density-presets--mobile button')
                    await expect(presets).to_have_count(3)
                    await presets.nth(1).click()
                    await expect(presets.nth(1)).to_have_attribute('aria-pressed', 'true')
                    await expect(panel.locator('.ue-density-note')).to_contain_text(
                        'Currently 2 per row' if locale == 'en' and width == 390 else
                        '当前实际每行 2 列' if locale == 'zh-CN' and width == 390 else
                        'Currently 1 per row' if locale == 'en' else '当前实际每行 1 列'
                    )
                else:
                    await panel.locator('.ue-density-presets button').last.click()
                    assert await panel.locator('input').input_value()=='6'
                    await panel.locator('input').focus()
                    await page.keyboard.press('ArrowRight')
                    assert await panel.locator('input').input_value()=='7'
                if width in (1440,390) and locale=='zh-CN':
                    await page.screenshot(animations='disabled',path=str(OUT/f'density-{width}.png'))
                await page.keyboard.press('Escape')
                await expect(panel).to_have_count(0)
                await expect(density).to_be_focused()
                if width in (1440,320) and locale=='en':
                    card=page.locator('.ue-gallery-card').first
                    await card.dblclick()
                    await expect(page.locator('.ue-lightbox-media')).to_be_visible()
                    await expect(page.locator('.ue-lightbox-loading')).to_have_count(0,timeout=20000)
                    assert await page.locator('.ue-modal-backdrop--lightbox').evaluate('(e)=>getComputedStyle(e).transform')=='none'
                    await expect(page.locator('.ue-lightbox-media img')).to_be_visible()
                    await expect(page.locator('.ue-modal-backdrop--lightbox')).to_have_css('opacity','1')
                    await expect(page.locator('.ue-modal-backdrop--lightbox')).to_have_css('background-color','rgba(18, 18, 18, 0.97)')
                    await page.screenshot(animations='disabled',path=str(OUT/f'lightbox-{width}.png'))
                    await page.locator('.ue-lightbox-media img').dblclick()
                    await expect(page.locator('.ue-lightbox-media img')).to_have_css('--ue-zoom','2')
                    if width==320:
                        assert await tour.count()==0
                        assert await page.locator('.ue-lightbox-media img').evaluate('(e)=>getComputedStyle(e).transitionDuration')=='0s'
                    await page.keyboard.press('ArrowRight')
                    await expect(page.locator('.ue-lightbox-loading')).to_have_count(0,timeout=20000)
                    await page.keyboard.press('Escape')
                    await expect(page.locator('.ue-lightbox-media')).to_have_count(0)
                await context.close()
        await browser.close()
    assert not report['errors'], report['errors']
    (OUT/'browser-rc2.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(f'PASS: {len(report["tours"])} full first-run tours, 88 steps; workspace descriptions, density keyboard/presets, focus/inert, both locales, mobile/reduced motion, lightbox. Evidence: {OUT}')

asyncio.run(main())
