// Sulle pagine web il menu del tasto destro sta nello strato alto e risponde solo se il browser lo vede intero (#586):
// le sue etichette, l'icona trascinata e i sotto-menu gli stanno dentro, si vedono e non lo spengono.
import { test, expect } from './fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA = `<!doctype html><title>Testo</title><body style="font:16px sans-serif">
<p id="t" style="margin:60px">Una riga di testo</p><input id="c" style="margin:60px;width:300px"></body>`;

// Quello che si vede al centro di un elemento che il puntatore attraversa: si rende colpibile solo per guardarlo.
async function sopraTutto(page, selettore) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.style.display === 'none') return 'assente';
    const prima = el.style.pointerEvents;
    el.style.pointerEvents = 'auto';
    const r = el.getBoundingClientRect();
    const sopra = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    el.style.pointerEvents = prima;
    return sopra && (sopra === el || el.contains(sopra)) ? 'visibile' : `coperto da ${sopra && sopra.className}`;
  }, selettore);
}

async function apriMenu(page) {
  const box = await page.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu-row-btn[data-sn-icon-id="newTab"]').first()).toBeVisible({ timeout: 5000 });
  await sleep(400);
}

test('l’etichetta di un’icona del menu si vede sopra il menu', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await apriMenu(page);
  const bb = await page.locator('.sn-menu-row-btn[data-sn-icon-id="newTab"]').first().boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 4 });
  await expect.poll(() => page.evaluate(() => {
    const t = document.querySelector('.sn-tooltip');
    return t && t.style.display !== 'none' ? t.textContent : '';
  })).toBe('Nuova scheda');
  expect(await sopraTutto(page, '.sn-tooltip')).toBe('visibile');
});

test('l’icona trascinata per riordinare il menu si vede mentre la si porta', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await apriMenu(page);
  const a = await page.locator('.sn-menu-row-btn[data-sn-icon-id="newTab"]').first().boundingBox();
  const b = await page.locator('.sn-menu-row-btn[data-sn-icon-id="translate"]').first().boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x - 20, a.y + 10, { steps: 5 });
  await page.mouse.move((a.x + b.x) / 2, a.y + 12, { steps: 8 });
  await sleep(200);
  const esito = await sopraTutto(page, '.sn-drag-preview');
  await page.mouse.up();
  expect(esito).toBe('visibile');
});

async function incollaDopoCronologia(app, page) {
  await app.evaluate(({ clipboard }) => clipboard.writeText('voce-vecchia'));
  await page.locator('#c').click({ button: 'right' });
  await page.locator('.sn-menu .sn-menu-paste-main').first().click();
  await expect.poll(() => page.locator('#c').inputValue()).toBe('voce-vecchia');
  await page.locator('#c').fill('');
  await app.evaluate(({ clipboard }) => clipboard.writeText('voce-nuova'));
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  await page.locator('.sn-menu-paste-arrow').first().hover();
  await sleep(900);
  const bb = await page.locator('.sn-menu .sn-menu-paste-main').first().boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 3 });
  await sleep(700);
  await page.mouse.down(); await page.mouse.up();
  await expect.poll(() => page.locator('#c').inputValue(), { timeout: 5000 }).toBe('voce-nuova');
}

test('con la cronologia degli appunti aperta, un clic vero su Incolla incolla', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await incollaDopoCronologia(app, page);
});

test('con la scelta del modello di Detta aperta, un clic vero su Incolla incolla', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('voce-detta'));
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  await page.locator('.sn-menu-split-arrow').first().hover();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.sn-menu').length)).toBe(2);
  const bb = await page.locator('.sn-menu .sn-menu-paste-main').first().boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 3 });
  await sleep(300);
  await page.mouse.down(); await page.mouse.up();
  await expect.poll(() => page.locator('#c').inputValue(), { timeout: 5000 }).toBe('voce-detta');
});

test('nella griglia «Altro» l’etichetta di un’icona si vede', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await apriMenu(page);
  await page.locator('.sn-menu-row-overflow').first().hover();
  const icona = page.locator('.sn-menu-icon-grid button[aria-label]').first();
  await expect(icona).toBeVisible({ timeout: 5000 });
  const bb = await icona.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 4 });
  await expect.poll(() => page.evaluate(() => {
    const t = document.querySelector('.sn-tooltip');
    return !!(t && t.style.display !== 'none' && t.textContent);
  })).toBe(true);
  expect(await sopraTutto(page, '.sn-tooltip')).toBe('visibile');
});
