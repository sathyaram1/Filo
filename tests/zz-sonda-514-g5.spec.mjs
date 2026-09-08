// Sonda usa e getta (giro 5, #514): a schermo intero, l'Esc dei riquadri delle
// PAGINE DI FILO che non dichiarano il tasto.
import { test, expect } from './fixtures/electron.mjs';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen };
  });
}
async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}
async function esc(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 900));
}

test('gestione: menu di ordinamento aperto', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.click('#mgSortBtn');
  await page.waitForTimeout(300);
  const apertoPrima = await page.evaluate(() => !!document.querySelector('.mg-sort-menu, .sn-select-pop'));
  console.log('sort menu aperto:', apertoPrima, 'classi:', await page.evaluate(() => Array.from(document.querySelectorAll('body > div')).map((d) => d.className).join(' | ')));
  await entra(app);
  await esc(app);
  const dopo = await page.evaluate(() => !!document.querySelector('.mg-sort-menu, .sn-select-pop'));
  const st = await stato(app);
  console.log('SORT → menu ancora aperto:', dopo, '| schermo intero:', st.cf);
  expect({ menuAperto: dopo, schermoIntero: st.cf }).toEqual({ menuAperto: false, schermoIntero: true });
});

test('gestione: barra di ricerca aperta, fuoco fuori dal campo', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.click('#mgSearchToggle');
  await page.waitForTimeout(300);
  await page.evaluate(() => { try { document.activeElement.blur(); } catch (_) {} document.body.focus(); });
  const prima = await page.evaluate(() => !document.getElementById('mgSearchBar').hidden);
  console.log('ricerca aperta prima:', prima);
  await entra(app);
  await esc(app);
  const dopo = await page.evaluate(() => !document.getElementById('mgSearchBar').hidden);
  const st = await stato(app);
  console.log('RICERCA → ancora aperta:', dopo, '| schermo intero:', st.cf);
  expect({ ricercaAperta: dopo, schermoIntero: st.cf }).toEqual({ ricercaAperta: false, schermoIntero: true });
});
