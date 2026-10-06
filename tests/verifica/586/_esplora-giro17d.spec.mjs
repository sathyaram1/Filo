// Esplorazione del giro 17 (si cancella): il menu sulle pagine web risponde a un clic vero dopo un'attesa sull'icona.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA = `<!doctype html><title>Testo</title><body style="font:16px sans-serif">
<p id="t" style="margin:60px">Parola da copiare con il menu di Filo</p><input id="c" style="margin:60px;width:300px"></body>`;

async function infoMenu(page) {
  return page.evaluate(() => [...document.querySelectorAll('.sn-menu-row-btn')].map((b) => ({
    id: b.dataset.snIconId || '', label: b.getAttribute('aria-label') || '',
  })));
}

for (const attesa of [0, 700]) {
  test(`copia dalla riga di icone dopo ${attesa} ms sopra l'icona`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    mkdirSync(SHOTS, { recursive: true });
    await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
    const page = await testServer.openReady(openTab, PAGINA);
    await page.evaluate(() => {
      const r = document.createRange(); r.selectNodeContents(document.getElementById('t'));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    const box = await page.locator('#t').boundingBox();
    await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
    await sleep(500);
    const icone = await infoMenu(page);
    console.log('icone', JSON.stringify(icone));
    const copia = icone.find((i) => /copia/i.test(i.label));
    if (!copia) { console.log('nessuna icona Copia'); return; }
    const b = page.locator(`.sn-menu-row-btn[aria-label="${copia.label}"]`).first();
    const bb = await b.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 4 });
    await sleep(attesa);
    if (attesa) {
      const tip = await page.evaluate(() => {
        const t = document.querySelector('.sn-tooltip');
        if (!t || t.style.display === 'none') return null;
        const r = t.getBoundingClientRect();
        const m = document.querySelector('.sn-menu').getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const sopra = document.elementFromPoint(cx, cy);
        return { tip: [r.left, r.top, r.width, r.height].map(Math.round), menu: [m.left, m.top, m.width, m.height].map(Math.round), sopra: sopra && sopra.className, pop: t.matches(':popover-open') };
      });
      console.log('tooltip', JSON.stringify(tip));
      await page.screenshot({ path: join(SHOTS, `586-giro17-tooltip.png`) });
    }
    await page.mouse.down(); await page.mouse.up();
    await sleep(800);
    const ora = await app.evaluate(({ clipboard }) => clipboard.readText());
    console.log(`appunti dopo il clic (attesa ${attesa})`, JSON.stringify(ora));
    expect(ora).toContain('Parola da copiare');
  });
}

test('con la cronologia degli appunti aperta, un clic sulla voce del menu principale', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('voce-uno'));
  const p1 = await testServer.openReady(openTab, '<!doctype html><title>A</title><input id="c" style="margin:40px">');
  await p1.locator('#c').click({ button: 'right' });
  await p1.locator('.sn-menu .sn-menu-paste-main').first().click();
  await app.evaluate(({ clipboard }) => clipboard.writeText('voce-due'));
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  const freccia = page.locator('.sn-menu-paste-arrow').first();
  console.log('freccia', await freccia.count());
  if (!(await freccia.count())) return;
  await freccia.hover();
  await sleep(900);
  console.log('sotto menu aperto', await page.evaluate(() => document.querySelectorAll('.sn-menu').length));
  await page.screenshot({ path: join(SHOTS, `586-giro17-storia.png`) });
  const incolla = page.locator('.sn-menu .sn-menu-paste-main').first();
  const bb = await incolla.boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 3 });
  await sleep(150);
  await page.mouse.down(); await page.mouse.up();
  await sleep(800);
  const v = await page.locator('#c').inputValue();
  console.log('campo dopo Incolla con la cronologia aperta', JSON.stringify(v));
  expect(v).toBe('voce-due');
});
