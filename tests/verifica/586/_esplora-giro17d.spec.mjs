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
  test(`un'icona della riga risponde dopo ${attesa} ms sopra di lei`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    mkdirSync(SHOTS, { recursive: true });
    const page = await testServer.openReady(openTab, PAGINA);
    const schede = () => shell.locator('.tab').count();
    const prima = await schede();
    const box = await page.locator('#t').boundingBox();
    await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
    await sleep(500);
    const b = page.locator('.sn-menu-row-btn[data-sn-icon-id="newTab"]').first();
    const bb = await b.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 4 });
    await sleep(attesa);
    if (attesa) {
      const tip = await page.evaluate(() => {
        const t = document.querySelector('.sn-tooltip');
        if (!t || t.style.display === 'none') return null;
        const r = t.getBoundingClientRect();
        const m = document.querySelector('.sn-menu').getBoundingClientRect();
        const sopra = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { tip: [r.left, r.top, r.width, r.height].map(Math.round), menu: [m.left, m.top, m.width, m.height].map(Math.round), sopra: sopra && sopra.className, pop: t.matches(':popover-open') };
      });
      console.log('tooltip', JSON.stringify(tip));
      await page.screenshot({ path: join(SHOTS, `586-giro17-tooltip.png`) });
    }
    await page.mouse.down(); await page.mouse.up();
    await sleep(1200);
    console.log(`schede prima ${prima} dopo ${await schede()} (attesa ${attesa})`);
    expect(await schede()).toBe(prima + 1);
  });
}

test('con la cronologia degli appunti aperta, un clic su Incolla incolla', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('voce-uno'));
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#c').click({ button: 'right' });
  await page.locator('.sn-menu .sn-menu-paste-main').first().click();
  await expect.poll(() => page.locator('#c').inputValue()).toBe('voce-uno');
  await page.locator('#c').fill('');
  await app.evaluate(({ clipboard }) => clipboard.writeText('voce-due'));
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  const freccia = page.locator('.sn-menu-paste-arrow').first();
  await freccia.hover();
  await sleep(900);
  console.log('menu aperti', await page.evaluate(() => document.querySelectorAll('.sn-menu').length));
  await page.screenshot({ path: join(SHOTS, `586-giro17-storia.png`) });
  const bb = await page.locator('.sn-menu .sn-menu-paste-main').first().boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 3 });
  await sleep(150);
  await page.mouse.down(); await page.mouse.up();
  await sleep(800);
  const v = await page.locator('#c').inputValue();
  console.log('campo dopo Incolla con la cronologia aperta', JSON.stringify(v));
  expect(v).toBe('voce-due');
});

for (const dopo of [150, 700, 2000]) {
  test(`cronologia aperta, sposto su Incolla, aspetto ${dopo} ms, clic`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await app.evaluate(({ clipboard }) => clipboard.writeText('voce-uno'));
    const page = await testServer.openReady(openTab, PAGINA);
    await page.locator('#c').click({ button: 'right' });
    await page.locator('.sn-menu .sn-menu-paste-main').first().click();
    await expect.poll(() => page.locator('#c').inputValue()).toBe('voce-uno');
    await page.locator('#c').fill('');
    await app.evaluate(({ clipboard }) => clipboard.writeText('voce-due'));
    await page.locator('#c').click({ button: 'right' });
    await sleep(500);
    await page.locator('.sn-menu-paste-arrow').first().hover();
    await sleep(900);
    const bb = await page.locator('.sn-menu .sn-menu-paste-main').first().boundingBox();
    await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 3 });
    await sleep(dopo);
    const aperti = await page.evaluate(() => document.querySelectorAll('.sn-menu').length);
    await page.mouse.down(); await page.mouse.up();
    await sleep(800);
    console.log(`dopo ${dopo} ms: menu aperti al clic ${aperti}, campo`, JSON.stringify(await page.locator('#c').inputValue()));
  });
}

test('griglia Altro aperta: clic su Aiuto del menu principale', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  await page.locator('.sn-menu-row-overflow').first().hover();
  await sleep(900);
  console.log('menu aperti con Altro', await page.evaluate(() => document.querySelectorAll('.sn-menu').length));
  const n0 = await shell.locator('.tab').count();
  const item = page.locator('.sn-menu-item', { hasText: 'Invia feedback' }).first();
  const bb = await item.boundingBox();
  await page.mouse.move(bb.x + 20, bb.y + bb.height / 2, { steps: 3 });
  await sleep(300);
  await page.mouse.down(); await page.mouse.up();
  await sleep(1500);
  console.log('menu dopo clic', await page.evaluate(() => document.querySelectorAll('.sn-menu').length), 'schede', n0, '->', await shell.locator('.tab').count());
});

test('una voce della cronologia si incolla con un clic', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('voce-uno'));
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#c').click({ button: 'right' });
  await page.locator('.sn-menu .sn-menu-paste-main').first().click();
  await expect.poll(() => page.locator('#c').inputValue()).toBe('voce-uno');
  await page.locator('#c').fill('');
  await app.evaluate(({ clipboard }) => clipboard.writeText('voce-due'));
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  await page.locator('.sn-menu-paste-arrow').first().hover();
  await sleep(900);
  const voce = page.locator('.sn-menu', { hasText: 'Svuota cronologia' }).getByText('voce-uno').first();
  const bb = await voce.boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 5 });
  await sleep(400);
  await page.mouse.down(); await page.mouse.up();
  await sleep(800);
  console.log('voce della cronologia, campo', JSON.stringify(await page.locator('#c').inputValue()));
});

test('trascinare un’icona del menu: l’anteprima si vede e l’ordine cambia', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  const ordine = () => page.evaluate(() => [...document.querySelectorAll('.sn-menu-row-btn')].map((b) => b.dataset.snIconId || '?').join(','));
  console.log('ordine prima', await ordine());
  const a = await page.locator('.sn-menu-row-btn[data-sn-icon-id="newTab"]').first().boundingBox();
  const b = await page.locator('.sn-menu-row-btn[data-sn-icon-id="translate"]').first().boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x - 20, a.y + 10, { steps: 5 });
  await page.mouse.move((a.x + b.x) / 2, a.y + 12, { steps: 8 });
  await sleep(300);
  await page.screenshot({ path: join(SHOTS, '586-giro17-trascina.png'), clip: { x: 0, y: 0, width: 600, height: 400 } });
  await page.mouse.move(b.x + 2, b.y + b.height / 2, { steps: 5 });
  await sleep(200);
  await page.mouse.up();
  await sleep(600);
  console.log('ordine dopo', await ordine());
});
