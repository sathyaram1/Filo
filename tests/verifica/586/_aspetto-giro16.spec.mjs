// Esplorazione del giro 16 (si cancella): il menu sulle pagine web nello strato alto, nei due temi, con la cronologia.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('menu sul web', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  mkdirSync(SHOTS, { recursive: true });
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima voce copiata'));
  const p1 = await testServer.openReady(openTab, '<!doctype html><title>A</title><input id="c">');
  await p1.locator('#c').click({ button: 'right' });
  await p1.locator('.sn-menu .sn-menu-paste-main').first().click();
  await app.evaluate(({ clipboard }) => clipboard.writeText('seconda voce'));
  const page = await testServer.openReady(openTab, `<!doctype html><title>Pagina</title>
    <style>body{background:linear-gradient(90deg,#fff,#cde);font:16px sans-serif} p{max-width:600px}</style>
    <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.</p>
    <input id="campo" style="width:300px;margin:40px"><p>Altro testo della pagina, sotto al campo, per vedere cosa copre il menu.</p>`);
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.locator('#campo').click({ button: 'right' });
    await sleep(600);
    await page.screenshot({ path: join(SHOTS, `586-giro16-menu-${tema}.png`) });
    const freccia = page.locator('.sn-menu-paste-arrow');
    if (await freccia.count()) { await freccia.hover(); await sleep(800); }
    await page.screenshot({ path: join(SHOTS, `586-giro16-menu-storia-${tema}.png`) });
    const info = await page.evaluate(() => [...document.querySelectorAll('.sn-menu')].map((m) => {
      const r = m.getBoundingClientRect(); const c = getComputedStyle(m);
      return { cls: m.className, pop: m.matches(':popover-open'), x: r.x, y: r.y, w: r.width, h: r.height, bg: c.backgroundColor, bd: c.borderTopWidth + ' ' + c.borderTopColor, pad: c.padding, color: c.color };
    }));
    console.log(tema, JSON.stringify(info));
    await page.keyboard.press('Escape');
    await sleep(300);
  }
  expect(true).toBe(true);
});
