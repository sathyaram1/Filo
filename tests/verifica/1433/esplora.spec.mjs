// Esplorazione del giro 5: si cancella.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const EDITOR = 'filo://editor/editor.html';
const SHOTS = 'tests/.shots/v1433g5';
mkdirSync(SHOTS, { recursive: true });
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));
async function apri(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  return ed;
}
const finestra = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w.getContentBounds();
});

test('due schede Editor: uno strumento messo in una compare nell\'altra; il lucchetto le tiene aperte tutte e due', async ({ app, openTab }) => {
  const a = await apri(openTab);
  const b = await apri(openTab);
  await b.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(b)).toBe(true);
  await b.click('.pd-piu');
  await b.click('.pd-catalogo .pd-voce[data-elemento="bold"]');
  await expect(b.locator('.pd-elementi .pd-elemento[data-elemento="bold"]')).toHaveCount(1);
  await expect.poll(() => a.evaluate(() => !!document.querySelector('.pd-elementi .pd-elemento[data-elemento="bold"]'))).toBe(true);
  await b.click('.pd-lucchetto');
  await expect.poll(() => a.evaluate(() => document.documentElement.classList.contains('pd-bloccato'))).toBe(true);
});

test('tutti gli strumenti in una finestra bassa: l\'ultimo si raggiunge', async ({ app, openTab }) => {
  const ed = await apri(openTab);
  for (const el of ['bold', 'italic', 'underline', 'undo', 'redo', 'font-size', 'align', 'font', 'settings']) {
    await app.evaluate((_e, el) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: el }), el);
  }
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); w.unmaximize(); w.setSize(1000, 560); });
  await ed.waitForTimeout(600);
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(400);
  await ed.screenshot({ path: `${SHOTS}/tutti-bassa.png` });
  const ultimo = ed.locator('.pd-elementi .pd-elemento').last();
  await ultimo.scrollIntoViewIfNeeded();
  const r = await ultimo.boundingBox();
  const h = await ed.evaluate(() => window.innerHeight);
  expect(r.y + r.height).toBeLessThanOrEqual(h + 1);
  await ed.click('.pd-piu');
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: `${SHOTS}/tutti-bassa-espanso.png` });
});

test('tema scuro: chiuso, aperto, espanso, bloccato con Aiuto', async ({ app, openTab }) => {
  const ed = await apri(openTab);
  await ed.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
  await ed.waitForTimeout(500);
  await ed.click('#doc');
  await ed.keyboard.type('Una riga di prova nel foglio scuro, abbastanza lunga da andare a capo almeno una volta dentro la colonna di testo centrata.');
  await ed.screenshot({ path: `${SHOTS}/scuro-chiuso.png` });
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.waitForTimeout(400);
  await ed.screenshot({ path: `${SHOTS}/scuro-aperto.png` });
  await ed.click('.pd-piu');
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: `${SHOTS}/scuro-espanso.png` });
  await ed.click('.pd-piu');
  await ed.click('.pd-lucchetto');
  await ed.waitForTimeout(300);
  await ed.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await ed.waitForTimeout(900);
  await ed.screenshot({ path: `${SHOTS}/scuro-bloccato-aiuto.png` });
  // Aiuto ridotto con un clic sul foglio
  await ed.mouse.click(300, 300);
  await ed.waitForTimeout(800);
  await ed.screenshot({ path: `${SHOTS}/scuro-bloccato-aiuto-ridotto.png` });
});

test('chiaro: commenta dal pannello aperto con la striscia', async ({ app, openTab }) => {
  const ed = await apri(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma delta');
  await ed.keyboard.press('Control+A');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: `${SHOTS}/chiaro-aperto.png` });
  await ed.locator('.pd-elemento[data-elemento="comment"] button').first().click();
  await ed.waitForTimeout(500);
  await ed.screenshot({ path: `${SHOTS}/chiaro-commenta.png` });
});
