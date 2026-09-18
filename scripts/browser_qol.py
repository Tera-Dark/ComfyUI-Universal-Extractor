"""QoL regression against the isolated preview, never a real image directory."""
import asyncio,json,sys
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8189'
OUT=Path(sys.argv[2] if len(sys.argv)>2 else 'artifacts/qol-evidence')
OUT.mkdir(parents=True,exist_ok=True)

async def main():
    errors=[];cases=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch()
        for width,height in [(1440,960),(390,844)]:
            for locale in ['zh-CN','en']:
                page=await browser.new_page(viewport={'width':width,'height':height})
                page.on('pageerror',lambda error:errors.append(str(error)))
                await page.add_init_script(f'localStorage.setItem("universal-extractor-locale",{json.dumps(locale)});localStorage.setItem("universal-extractor:onboarding-tour-v1-completed","true")')
                await page.goto(BASE+'/gallery/',wait_until='networkidle')
                async def workspace(index):
                    await page.locator('[data-tour-id="workspace-switcher"]').click()
                    await page.locator('.ue-workspace-switcher .ue-topbar-tab').nth(index).click()
                for index,name in [(1,'library'),(2,'workbench'),(3,'settings')]:
                    await workspace(index)
                    marker=page.locator({'library':'.ue-library-actions','workbench':'.ue-workbench-rail','settings':'.ue-settings-preferences'}[name])
                    await expect(marker).to_be_visible()
                    assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth'),(width,locale,name,'horizontal overflow')
                    await page.screenshot(path=str(OUT/f'{name}-{width}-{locale}.png'),animations='disabled')
                    if name=='workbench':
                        await expect(page.locator('.ue-workbench-tool-tab').first).to_have_attribute('aria-pressed','true')
                        assert await page.locator('.ue-workbench-rail').evaluate('(e)=>getComputedStyle(e).flexDirection')=='row'
                        assert await page.locator('.ue-qol-disclosure').get_attribute('open') is None
                        await page.locator('.ue-tool-result').first.fill('Retained prompt draft')
                        await page.locator('.ue-workbench-tool-tab').last.click()
                        await expect(page.locator('.ue-inspiration-workspace')).to_be_visible()
                        await page.screenshot(path=str(OUT/f'inspiration-{width}-{locale}.png'),animations='disabled')
                    if name=='settings':
                        # New source must not jump back to default; edits must survive a cancelled tab switch.
                        await page.locator('.ue-settings-source-list > button').click()
                        fields=page.locator('.ue-settings-form input')
                        await fields.nth(0).fill('Unsaved demo')
                        await fields.nth(1).fill('/not-a-real-source')
                        await workspace(0)
                        dialog=page.get_by_role('alertdialog')
                        await expect(dialog).to_be_visible()
                        await dialog.get_by_role('button',name='取消' if locale=='zh-CN' else 'Cancel',exact=True).click()
                        await expect(fields.nth(0)).to_have_value('Unsaved demo')
                        await workspace(0)
                        await page.get_by_role('alertdialog').get_by_role('button',name='放弃修改' if locale=='zh-CN' else 'Discard changes',exact=True).click()
                await workspace(2)
                await page.locator('.ue-workbench-tool-tab').first.click()
                await expect(page.locator('.ue-tool-result').first).to_have_value('Retained prompt draft')
                await workspace(0)
                await expect(page.locator('.ue-gallery-card').first).to_be_visible()
                await page.locator('[data-tour-id="gallery-filters"]').click()
                menu=page.locator('.ue-filter-menu')
                await expect(menu).to_be_visible()
                b=await menu.bounding_box()
                assert b['x']>=0 and b['x']+b['width']<=width+1,(width,locale,'filter bounds',b)
                await page.screenshot(path=str(OUT/f'filters-{width}-{locale}.png'),animations='disabled')
                await page.keyboard.press('Escape')
                await expect(menu).to_have_count(0)
                await expect(page.locator('[data-tour-id="gallery-filters"]')).to_be_focused()
                await page.locator('.ue-toolbar-more > summary').click()
                await page.get_by_role('button',name='开启双栏目录整理' if locale=='zh-CN' else 'Open folder organizer',exact=True).click()
                await expect(page.locator('.ue-dual-pane').first).to_be_visible()
                await expect(page.locator('.ue-dual-card').first).to_be_visible()
                assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth'),('dual overflow',width,locale)
                await page.screenshot(path=str(OUT/f'organizer-{width}-{locale}.png'),animations='disabled')
                # Change mode; no files are modified by this browser smoke.
                await page.locator('.ue-toolbar-more > summary').click()
                await page.get_by_role('button',name='变体' if locale=='zh-CN' else 'Variants',exact=True).click()
                await expect(page.locator('.ue-variant-tools')).to_be_visible()
                await page.locator('.ue-variant-tools input').fill('no-such-group')
                await expect(page.locator('.ue-variant-card')).to_have_count(0)
                await page.screenshot(path=str(OUT/f'variants-{width}-{locale}.png'),animations='disabled')
                cases.append({'width':width,'locale':locale,'passed':True})
                await page.close()
        await browser.close()
    assert not errors,errors
    (OUT/'browser-qol.json').write_text(json.dumps({'cases':cases,'page_errors':errors,'environment':'isolated preview, no real ComfyUI'},indent=2))
    print('PASS: 4 locale/viewport cases; workspaces, optional tools, unsaved source guard, filter Escape/focus, organizer, variant search. No page errors.')

asyncio.run(main())
