// #1340, giro 4, rilievo 1: spostato l'Aiuto dalla testata, pezzi di Filo rimasti sopra il microfono (lo strato del
// correttore, l'avviso della guardia) contano come un velo del sito, e il clic dell'utente si ferma.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const SITO = `
  window.stendi = () => {
    const v = document.createElement('div');
    v.id = 'velo';
    v.style.cssText = 'position:fixed;inset:0;background:#fff;pointer-events:none;z-index:2147483647';
    document.body.appendChild(v);
  };
  window.togli = () => { const v = document.getElementById('velo'); if (v) v.remove(); };
`;
const pagina = () => `<!doctype html><html><head><meta charset="utf-8"><title>Un sito</title></head><body style="padding:40px;font:16px sans-serif"><h1>Un sito</h1><script>${SITO}</script></body></html>`;
const avvisoCoperto = (page) => page.locator('.sn-toast', { hasText: 'L\'Aiuto era coperto' });
async function apriAiuto(shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
}
const contaAscolti = (app, page) => nelMondoDiFilo(app, page, () => {
  globalThis.__ascolti = 0;
  globalThis.SN_ASCOLTO.avvia = async () => { globalThis.__ascolti += 1; return null; };
  return true;
});
const ascolti = (app, page) => nelMondoDiFilo(app, page, () => globalThis.__ascolti);
async function centro(locator) {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function sposta(page, dx, dy) {
  const h = await page.locator('.sn-sidebar-header').boundingBox();
  await page.mouse.move(h.x + 30, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 30 + dx, h.y + h.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}

test('r1 il microfono dell\'Aiuto spostato dalla testata parte al clic', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  await page.waitForTimeout(1500);
  await sposta(page, -120, 60);
  await page.waitForTimeout(2000);
  const p = await centro(page.locator('.sn-sidebar .sn-voce-btn'));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  expect(await avvisoCoperto(page).count(), 'nessun velo: niente avviso').toBe(0);
  expect(await ascolti(app, page)).toBe(1);
});

test('r1 col pannello spostato l\'avviso della guardia cade sul microfono e ferma il clic dopo che il velo se n\'è andato', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  await page.waitForTimeout(1500);
  await sposta(page, -90, 30);
  // Un tasto nella casella rimette a posto lo strato del correttore: resta solo l'avviso.
  await page.locator('.sn-sidebar-input textarea').click();
  await page.keyboard.type('a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(1500);
  const p = await centro(page.locator('.sn-sidebar .sn-voce-btn'));
  await page.evaluate(() => window.stendi());
  await page.waitForTimeout(700);
  await page.mouse.click(p.x, p.y);
  await expect(avvisoCoperto(page)).toBeVisible();
  await page.evaluate(() => window.togli());
  await page.waitForTimeout(1200);
  const sopra = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.sn-toast') ? 'avviso' : 'microfono', p);
  expect(sopra, 'l\'avviso non copre il microfono').toBe('microfono');
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  expect(await ascolti(app, page)).toBe(1);
});
