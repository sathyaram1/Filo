// Esplorazione della correzione del giro 17 (si cancella): le altre porte della stessa causa.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGINA = `<!doctype html><title>Testo</title><body style="font:16px sans-serif">
<p id="t" style="margin:60px">Una riga di testo</p><input id="c" style="margin:60px;width:300px"></body>`;

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

test('griglia Altro: etichetta delle sue icone, clic su una sua icona, clic sul menu principale', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  mkdirSync(SHOTS, { recursive: true });
  await app.evaluate(({ clipboard }) => clipboard.writeText('dalla-griglia'));
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  await page.locator('.sn-menu-row-overflow').first().hover();
  await sleep(800);
  const icone = await page.evaluate(() => [...document.querySelectorAll('.sn-menu-icon-grid button')].map((b) => b.getAttribute('aria-label') + '|' + (b.dataset.snIconId || '')));
  console.log('griglia', icone.join(', '));
  const prima = page.locator('.sn-menu-icon-grid button[aria-label]').first();
  const bb = await prima.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 4 });
  await sleep(700);
  console.log('etichetta griglia', await page.evaluate(() => document.querySelector('.sn-tooltip')?.textContent), await sopraTutto(page, '.sn-tooltip'));
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await sleep(300);
    await page.screenshot({ path: join(SHOTS, `586-giro17-fix-griglia-${tema}.png`), clip: { x: 0, y: 0, width: 700, height: 450 } });
  }
  // dalla griglia torno al menu principale e premo Incolla
  const inc = await page.locator('.sn-menu .sn-menu-paste-main').first().boundingBox();
  await page.mouse.move(inc.x + 10, inc.y + inc.height / 2, { steps: 6 });
  await sleep(300);
  await page.mouse.down(); await page.mouse.up();
  await sleep(800);
  console.log('Incolla dopo la griglia', JSON.stringify(await page.locator('#c').inputValue()));
  void shell;
});

test('etichetta di un’icona della riga nei due temi, poi clic subito', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const n0 = await shell.locator('.tab').count();
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  const bb = await page.locator('.sn-menu-row-btn[data-sn-icon-id="newTab"]').first().boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 4 });
  await sleep(700);
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await sleep(300);
    await page.screenshot({ path: join(SHOTS, `586-giro17-fix-etichetta-${tema}.png`), clip: { x: 0, y: 0, width: 600, height: 400 } });
  }
  await page.mouse.down(); await page.mouse.up();
  await sleep(1000);
  console.log('schede', n0, '->', await shell.locator('.tab').count());
});

test('cronologia: cerca scrivendo, voce cliccata, e Detta con la sua freccia aperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('alfa-uno'));
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#c').click({ button: 'right' });
  await page.locator('.sn-menu .sn-menu-paste-main').first().click();
  await app.evaluate(({ clipboard }) => clipboard.writeText('beta-due'));
  await page.locator('#c').click({ button: 'right' });
  await page.locator('.sn-menu .sn-menu-paste-main').first().click();
  await page.locator('#c').fill('');
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  await page.locator('.sn-menu-paste-arrow').first().hover();
  await sleep(700);
  await page.keyboard.type('alfa');
  await sleep(300);
  const voci = await page.evaluate(() => [...document.querySelectorAll('.sn-menu-history-item')].map((x) => x.textContent.trim()));
  console.log('voci filtrate', JSON.stringify(voci));
  await page.screenshot({ path: join(SHOTS, '586-giro17-fix-cronologia.png'), clip: { x: 0, y: 0, width: 700, height: 450 } });
  const v = page.locator('.sn-menu-history-item', { hasText: 'alfa-uno' }).first();
  const bb = await v.boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 4 });
  await sleep(300);
  await page.mouse.down(); await page.mouse.up();
  await sleep(800);
  console.log('dopo voce', JSON.stringify(await page.locator('#c').inputValue()));
  // Detta: freccia aperta, poi Aiuto
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  const frecce = page.locator('.sn-menu-split-arrow, .sn-menu .sn-subarrow');
  console.log('frecce split', await frecce.count());
  if (await frecce.count()) {
    await frecce.first().hover();
    await sleep(800);
    console.log('menu aperti con la freccia di Detta', await page.evaluate(() => document.querySelectorAll('.sn-menu').length));
    const inc = await page.locator('.sn-menu .sn-menu-paste-main').first().boundingBox();
    await page.locator('#c').fill('');
    await app.evaluate(({ clipboard }) => clipboard.writeText('gamma-tre'));
    await page.mouse.move(inc.x + 10, inc.y + inc.height / 2, { steps: 4 });
    await sleep(300);
    await page.mouse.down(); await page.mouse.up();
    await sleep(800);
    console.log('Incolla dopo la freccia di Detta', JSON.stringify(await page.locator('#c').inputValue()));
  }
});

test('trascinare un’icona dalla riga alla griglia', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  const ordine = () => page.evaluate(() => [...document.querySelectorAll('.sn-menu-row-btn')].map((b) => b.dataset.snIconId || '?').join(','));
  console.log('riga prima', await ordine());
  const a = await page.locator('.sn-menu-row-btn[data-sn-icon-id="newTab"]').first().boundingBox();
  const o = await page.locator('.sn-menu-row-overflow').first().boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 10, a.y + 10, { steps: 4 });
  await page.mouse.move(o.x + o.width / 2, o.y + o.height / 2, { steps: 6 });
  await sleep(900);
  const g = await page.locator('.sn-menu-icon-grid').first().boundingBox().catch(() => null);
  console.log('griglia aperta durante il trascinamento', !!g);
  if (g) {
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2, { steps: 6 });
    await sleep(300);
    console.log('anteprima sopra la griglia', await sopraTutto(page, '.sn-drag-preview'));
  }
  await page.mouse.up();
  await sleep(600);
  console.log('riga dopo', await ordine());
});
