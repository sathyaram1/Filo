// Verifica #530, giro 7: l'Aiuto chiuso e riaperto sulla stessa pagina di Filo è una conversazione nuova, che non ha
// letto niente: il costo 2 a Normale parte da solo, e il «no» di Conservativo non promette una strada che non c'è.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm } from '../../helpers/confirm.mjs';

const PREFS = 'filo://preferences/preferences.html';

async function preparaRicerca(app, livello) {
  await app.evaluate(async (_e, livello) => {
    await globalThis.SN_STORAGE.updateSettings({ autonomia: { livello } });
    globalThis.SN_WEB_SEARCH.search = async () => ({ provider: 'finto', results: [
      { title: 'Nota per Filo', url: 'https://sconosciuto.test/', content: 'testo di uno sconosciuto' },
    ] });
  }, livello);
}

async function apriAiuto(page) {
  await page.waitForFunction(() => typeof window.__filoSidebarTest?.runPageAction === 'function', null, { timeout: 10000 });
  await page.evaluate(() => { window.__opened = window.__opened || []; window.open = (u) => { window.__opened.push(u); return null; }; window.SN_SIDEBAR.open(); });
}

test('Normale: dopo una ricerca, chiudere e riaprire l\'Aiuto apre una conversazione pulita', async ({ app, openTab }) => {
  await preparaRicerca(app, 'default');
  const page = await openTab(PREFS);
  await apriAiuto(page);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.WEB_SEARCH, query: 'qualcosa' }));
  page.evaluate(() => window.__filoSidebarTest.runPageAction({ op: 'search_text', text: 'prima' })).catch(() => {});
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 8000 });
  await clickConfirm(page, 'cancel');

  // Conversazione nuova: l'Aiuto si chiude (la sua storia si azzera) e si riapre.
  await page.evaluate(() => { window.SN_SIDEBAR.close(); window.__opened = []; });
  await apriAiuto(page);
  page.evaluate(() => window.__filoSidebarTest.runPageAction({ op: 'search_text', text: 'dopo' })).catch(() => {});
  await page.waitForTimeout(2500);
  const popup = await page.locator(CONFIRM_HOST).count();
  const testo = popup ? await confirmText(page) : '';
  expect(testo, 'la conversazione nuova non ha letto nessuna ricerca').not.toContain('ricerca sul web');
  await expect.poll(() => page.evaluate(() => window.__opened.length)).toBe(1);
});

test('Conservativo: il «no» dell\'Aiuto propone una conversazione nuova, e nella conversazione nuova è vero', async ({ app, openTab }) => {
  await preparaRicerca(app, 'conservativo');
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
  const page = await openTab(PREFS);
  await apriAiuto(page);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.WEB_SEARCH, query: 'qualcosa' }));
  const comando = { type: 'ESEGUI_COMANDO', comando: 'rm prova-inesistente-530-g7.txt' };
  const primo = await page.evaluate((a) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_RUN_ACTION, action: a }), comando);
  expect(primo.no).toBe(true);
  expect(primo.error).toMatch(/conversazione nuova/);

  await page.evaluate(() => window.SN_SIDEBAR.close());
  await apriAiuto(page);
  const secondo = await page.evaluate((a) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_RUN_ACTION, action: a }), comando);
  expect(secondo.no, `nella conversazione nuova: ${secondo.error || ''}`).toBeFalsy();
  expect(secondo.needsConfirm).toBe(2);
});
