import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><body style="margin:0;font:16px system-ui">
  <p id="txt" style="padding:10px">Testo semplice da selezionare qui dentro.</p>
  <a id="lnk" href="https://example.com/x" style="display:block;padding:10px">Un link</a>
  <img id="img" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxMDAiIGhlaWdodD0iNjAiIGZpbGw9IiNjNDVhM2IiLz48L3N2Zz4=" style="display:block;margin:10px">
  <input id="inp" value="ciao mondo" style="display:block;margin:10px;width:300px">
  <textarea id="ta" style="display:block;margin:10px;width:300px;height:60px">testo area</textarea>
  <video id="vid" controls style="display:block;margin:10px;width:200px;height:100px"></video>
</body></html>`;

async function menuItems(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.sn-menu');
    if (!m) return null;
    return Array.from(m.children)
      .filter((c) => c.style.display !== 'none')
      .map((c) => (c.className || '') + ' :: ' + (c.textContent || '').trim().slice(0, 60));
  });
}

test('menu tasto destro su vari elementi', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  const targets = ['#txt', '#lnk', '#img', '#inp', '#ta', '#vid'];
  for (const sel of targets) {
    const box = await page.locator(sel).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForTimeout(700);
    const items = await menuItems(page);
    console.log(`### ${sel} -> ${JSON.stringify(items)}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // con selezione di testo
  await page.evaluate(() => {
    const p = document.getElementById('txt');
    const r = document.createRange();
    r.selectNodeContents(p);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  const b = await page.locator('#txt').boundingBox();
  await page.mouse.click(b.x + 40, b.y + b.height / 2, { button: 'right' });
  await page.waitForTimeout(700);
  console.log('### selezione -> ' + JSON.stringify(await menuItems(page)));
});
