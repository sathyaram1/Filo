// Esplorazione del giro 6 di #870: stress, due home insieme, colonna vuota, foto.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots', 'v870g6');
mkdirSync(SHOTS, { recursive: true });

async function home(app, salta = null) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x !== salta && x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (w) {
      await w.waitForLoadState('domcontentloaded');
      await expect(w.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
      return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}
const ordine = (page, col) => page.locator(`#${col} > .dash-carta`).evaluateAll((ns) => ns.map((n) => n.dataset.chiave || n.dataset.tipo));

test('stress avvisi e timer', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.addNotification({ kind: 'info', text: '<img src=x onerror="window.__xss=1"><b>grassetto</b>' });
    await M.addNotification({ kind: 'info', text: 'Un avviso lunghissimo '.repeat(40) });
    await M.addNotification({ kind: 'info', text: '🎉🍕🚀 emoji ovunque 👨‍👩‍👧‍👦' });
    await M.addNotification({ kind: 'info', text: '   ' });
    for (let i = 0; i < 12; i++) await M.addNotification({ kind: 'info', text: `Avviso numero ${i}` });
    for (let i = 0; i < 4; i++) await M.addTimer({ label: `Timer ${i} ` + 'x'.repeat(i * 30), seconds: 600 + i * 60 });
  });
  await page.reload();
  await home(app);
  await page.waitForTimeout(800);
  console.log('XSS', await page.evaluate(() => window.__xss));
  console.log('IMG in accade', await page.locator('#accade img').count());
  console.log('ACCADE', (await ordine(page, 'accade')).length);
  const ov = await page.evaluate(() => {
    const a = document.querySelector('#left');
    const d = document.documentElement;
    return { scrollH: a.scrollHeight, clientH: a.clientHeight, overflowY: getComputedStyle(a).overflowY, docScrollW: d.scrollWidth, docW: d.clientWidth, docScrollH: d.scrollHeight, docH: d.clientHeight };
  });
  console.log('OVERFLOW', JSON.stringify(ov));
  await page.screenshot({ path: join(SHOTS, 'stress-chiaro.png') });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, 'stress-scuro.png') });
  // scroll in fondo alla sinistra
  await page.evaluate(() => { const a = document.querySelector('#left'); a.scrollTop = a.scrollHeight; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SHOTS, 'stress-scuro-fondo.png') });
  // la carta spazi vuoti
  const vuota = page.locator('#accade .dash-carta[data-tipo="avviso"]').filter({ hasText: /^\s*$/ });
  console.log('AVVISO VUOTO count', await vuota.count());
});

test('due home insieme e colonna destra vuota', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const a = await home(app);
  const b = await openTab('filo://newtab/');
  await expect(b.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
  for (const tipo of ['mazzi', 'editor', 'suggerimenti', 'rapide']) {
    await a.locator(`#tieni .dash-carta[data-tipo="${tipo}"]`).click({ button: 'right', position: { x: 30, y: 12 } });
    await a.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
    await expect(a.locator(`#tieni .dash-carta[data-tipo="${tipo}"]`)).toHaveCount(0);
  }
  await b.waitForTimeout(800);
  console.log('B destra', await ordine(b, 'tieni'));
  console.log('A altro', await a.locator('#altro .dash-altro-app').evaluateAll((ns) => ns.map((n) => `${n.dataset.id}:${n.dataset.tolta || ''}`)));
  await a.screenshot({ path: join(SHOTS, 'destra-vuota.png') });
  // tasto destro sullo spazio vuoto della colonna destra
  const r = await a.locator('#right').boundingBox();
  await a.mouse.click(r.x + r.width / 2, r.y + 60, { button: 'right' });
  await a.waitForTimeout(300);
  console.log('MENU vuoto destra', await a.locator('.dash-menu .dash-menu-voce').allInnerTexts());
  await a.screenshot({ path: join(SHOTS, 'destra-vuota-menu.png') });
  await a.keyboard.press('Escape');
  // rimetto l'editor da B
  const cella = b.locator('#altro .dash-altro-cella', { has: b.locator('.dash-altro-app[data-id="editor"]') });
  await cella.hover();
  await cella.locator('.dash-altro-rimetti').click();
  await a.waitForTimeout(800);
  console.log('A destra dopo rimetti da B', await ordine(a, 'tieni'));
  // clic sull'icona di un'app senza carta
  console.log('altro apps', await b.locator('#altro .dash-altro-app').evaluateAll((ns) => ns.map((n) => `${n.dataset.id}|${n.getAttribute('title') || n.getAttribute('aria-label')}`)));
});

test('profilo e impostazioni in alto a destra; tastiera sulle carte', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const ctrl = await page.locator('#dashControls').evaluate((n) => ({ html: n.innerHTML.slice(0, 600), rect: n.getBoundingClientRect().toJSON() }));
  console.log('CONTROLS', JSON.stringify(ctrl.rect), ctrl.html);
  console.log('VW', await page.evaluate(() => innerWidth));
  // tastiera: Tab fino a una carta, poi ContextMenu
  await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').focus();
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(300);
  console.log('MENU shift+f10', await page.locator('.dash-menu .dash-menu-voce').allInnerTexts());
  await page.keyboard.press('Escape');
  await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').focus();
  await page.keyboard.press('ContextMenu');
  await page.waitForTimeout(300);
  console.log('MENU ContextMenu', await page.locator('.dash-menu .dash-menu-voce').allInnerTexts());
  await page.keyboard.press('Escape');
  // focus visibile
  await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').focus();
  await page.screenshot({ path: join(SHOTS, 'focus.png') });
  // tema scuro reale via impostazioni
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await page.reload();
  await home(app);
  await page.waitForTimeout(600);
  console.log('THEME attr', await page.evaluate(() => document.documentElement.getAttribute('data-sn-theme')));
  await page.screenshot({ path: join(SHOTS, 'scuro-base.png') });
});
