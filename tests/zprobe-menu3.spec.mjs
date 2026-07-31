import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><body style="margin:0;font:16px system-ui">
  <textarea id="ta" style="display:block;margin:10px;width:400px;height:80px">testo area da tagliare</textarea>
  <input id="inp" value="ciao mondo bello" style="display:block;margin:10px;width:400px">
  <div id="ce" contenteditable="true" style="margin:10px;width:400px;height:60px;border:1px solid #ccc">testo editabile qui</div>
  <video id="vid" src="https://example.com/v.mp4" controls style="display:block;margin:10px;width:200px;height:100px"></video>
  <audio id="aud" src="https://example.com/a.mp3" controls style="display:block;margin:10px"></audio>
</body></html>`;

async function menuItems(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.sn-menu');
    if (!m) return null;
    return Array.from(m.children)
      .filter((c) => c.style.display !== 'none')
      .map((c) => (c.textContent || '').trim().slice(0, 50));
  });
}

test('menu con selezione dentro campi editabili', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  // 1) textarea con selezione
  await page.evaluate(() => { const t = document.getElementById('ta'); t.focus(); t.setSelectionRange(0, 5); });
  let box = await page.locator('#ta').boundingBox();
  await page.mouse.click(box.x + 25, box.y + 12, { button: 'right' });
  await page.waitForTimeout(700);
  console.log('### textarea+selezione -> ' + JSON.stringify(await menuItems(page)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // 2) input con selezione
  await page.evaluate(() => { const t = document.getElementById('inp'); t.focus(); t.setSelectionRange(0, 4); });
  box = await page.locator('#inp').boundingBox();
  await page.mouse.click(box.x + 20, box.y + box.height / 2, { button: 'right' });
  await page.waitForTimeout(700);
  console.log('### input+selezione -> ' + JSON.stringify(await menuItems(page)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // 3) contenteditable con selezione
  await page.evaluate(() => {
    const el = document.getElementById('ce');
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  box = await page.locator('#ce').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 20, { button: 'right' });
  await page.waitForTimeout(700);
  console.log('### contenteditable+selezione -> ' + JSON.stringify(await menuItems(page)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // 4) video con src
  box = await page.locator('#vid').boundingBox();
  await page.mouse.click(box.x + 40, box.y + 20, { button: 'right' });
  await page.waitForTimeout(700);
  console.log('### video -> ' + JSON.stringify(await menuItems(page)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // 5) audio con src
  box = await page.locator('#aud').boundingBox();
  await page.mouse.click(box.x + 40, box.y + 10, { button: 'right' });
  await page.waitForTimeout(700);
  console.log('### audio -> ' + JSON.stringify(await menuItems(page)));
});
