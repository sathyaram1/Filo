// Verifica #2052.1, giro 2, rilievo 2: il testo rimesso nella casella arrivata tardi non toglie il fuoco a un menu del
// sito aperto in quel momento, che si chiuderebbe da solo.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><head><title>Tardi</title></head>
<body style="margin:0;padding:20px;font:16px sans-serif;background:#fff">
  <button id="apri">Menu</button>
  <div id="menu" hidden style="border:1px solid #999;width:200px"><button class="voce">Uno</button><button class="voce">Due</button></div>
  <div id="posto" style="margin-top:10px"></div>
  <script>
    setTimeout(() => { document.getElementById('posto').innerHTML = '<textarea name="commento" style="width:520px;height:140px"></textarea>'; }, 3000);
    const m = document.getElementById('menu');
    document.getElementById('apri').addEventListener('click', () => { m.hidden = false; m.querySelector('.voce').focus(); });
    m.addEventListener('focusout', (e) => { if (!m.contains(e.relatedTarget)) m.hidden = true; });
  </script>
</body></html>`;

const casella = (page) => page.locator('textarea[name=commento]');

test('r2 un menu aperto col fuoco su una voce resta aperto quando il testo torna', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await casella(page).click({ timeout: 8000 });
  await page.keyboard.type('commento salvato');
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');

  await page.locator('#apri').click();
  await expect(page.locator('#menu')).toBeVisible();
  await expect.poll(() => casella(page).inputValue().catch(() => ''), { timeout: 10_000 }).toBe('commento salvato');
  await page.waitForTimeout(300);
  await expect(page.locator('#menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement?.className)).toBe('voce');
});
