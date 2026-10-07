// Esplorazione giro 21 (#586): fotografia degli stili calcolati del menu sul web in vari stati, per confronto fra versioni.
import { test, expect } from '../../fixtures/electron.mjs';
import fs from 'node:fs';

const OUT = process.env.DUMP_OUT;
const PROPS = ['display', 'position', 'width', 'height', 'margin-top', 'margin-bottom', 'padding-top', 'padding-left', 'background-color',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'border-top-width', 'border-top-style', 'border-top-color',
  'border-radius', 'box-shadow', 'opacity', 'cursor', 'text-align', 'white-space', 'overflow-x', 'overflow-y', 'z-index', 'gap',
  'align-items', 'justify-content', 'flex-direction', 'list-style-type', 'text-decoration-line', 'outline-style', 'visibility', 'box-sizing',
  'vertical-align', 'appearance', 'max-width', 'min-width', 'max-height', 'transform'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dump(page) {
  return page.evaluate((props) => {
    const root = document.querySelector('.sn-menu');
    if (!root) return null;
    const all = [root, ...root.querySelectorAll('*')].filter((n) => !n.closest('svg') || n.tagName.toLowerCase() === 'svg');
    return all.map((n) => {
      const c = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      return `${n.tagName.toLowerCase()}.${(n.getAttribute('class') || '').trim().replace(/\s+/g, '.')} [${Math.round(r.width)}x${Math.round(r.height)}] ` + props.map((p) => `${p}=${c.getPropertyValue(p)}`).join('; ');
    });
  }, PROPS);
}

test('dump stati del menu', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const risultati = {};
  await app.evaluate(({ clipboard }) => clipboard.writeText('testo-uno'));
  const page = await testServer.openReady(openTab, `<!doctype html><title>Sito</title><body>
    <input id="c" style="margin:40px;width:300px" value="ciao">
    <p id="p" style="margin:40px">Una frase con <a id="l" href="https://example.com/x">un collegamento</a> e un testo qualunque.</p>
    <textarea id="t" spellcheck="true" style="margin:40px">qesto è sbagliatto</textarea></body>`);
  // 1. menu su un campo
  await page.locator('#c').click({ button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-paste-main').first()).toBeVisible({ timeout: 5000 });
  await sleep(500);
  risultati.campo = await dump(page);
  // 2. Incolla per riempire la cronologia, poi cronologia aperta
  await page.locator('.sn-menu .sn-menu-paste-main').first().click();
  await sleep(300);
  await page.locator('#c').click({ button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-paste-main').first()).toBeVisible({ timeout: 5000 });
  await sleep(400);
  const freccia = page.locator('.sn-menu-paste-arrow');
  if (await freccia.count()) { await freccia.first().hover(); await sleep(700); }
  risultati.cronologia = await dump(page);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await sleep(300);
  // 3. sottomenu Detta
  await page.locator('#c').click({ button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-paste-main').first()).toBeVisible({ timeout: 5000 });
  await sleep(400);
  const dettaFreccia = page.locator('.sn-menu-split-arrow');
  if (await dettaFreccia.count()) { await dettaFreccia.first().hover(); await sleep(700); }
  risultati.detta = await dump(page);
  // 4. Altro (griglia)
  const altro = page.locator('.sn-menu-row-overflow');
  if (await altro.count()) { await altro.first().hover(); await sleep(300); await altro.first().click(); await sleep(700); }
  risultati.altro = await dump(page);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await sleep(300);
  // 5. collegamento
  await page.locator('#l').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
  await sleep(700);
  risultati.link = await dump(page);
  await page.keyboard.press('Escape');
  await sleep(300);
  // 6. testo selezionato
  await page.evaluate(() => { const p = document.getElementById('p'); const r = document.createRange(); r.selectNodeContents(p.firstChild); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  const pb = await page.locator('#p').boundingBox();
  await page.mouse.click(pb.x + 20, pb.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
  await sleep(700);
  risultati.selezione = await dump(page);
  await page.screenshot({ path: `tests/.shots/586-giro21-dump-selezione-${process.env.DUMP_TAG || 'x'}.png` });
  await page.keyboard.press('Escape');
  await sleep(300);
  // 7. parola sbagliata
  const tb = await page.locator('#t').boundingBox();
  await page.locator('#t').click();
  await sleep(800);
  await page.mouse.click(tb.x + 15, tb.y + 10, { button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
  await sleep(1000);
  risultati.correzione = await dump(page);
  fs.writeFileSync(OUT, JSON.stringify(risultati, null, 1));
});
