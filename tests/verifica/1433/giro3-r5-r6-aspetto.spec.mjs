// Verifica #1433, giro 3, rilievi 5 e 6: la colonna di testo in una finestra stretta col pannello bloccato e l'Aiuto,
// e l'Impostazioni degli strumenti disegnato come gli altri strumenti del pannello.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const esegui = (app, a) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION(x), a);

test('r5 finestra larga 820, pannello bloccato e Aiuto aperti: la colonna di testo resta leggibile (almeno 280 pixel)', async ({ app, openTab }) => {
  const ed = await openTab(EDITOR);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1' && document.querySelector('.pd-elemento'));
  await ed.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = Array.from({ length: 6 }, () => '<p>Una riga di testo abbastanza lunga da arrivare fino al bordo destro della colonna.</p>').join('');
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setBounds({ x: 0, y: 0, width: 820, height: 700 }));
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'blocca' });
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-bloccato'))).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.waitForTimeout(600);
  const largo = await ed.evaluate(() => document.getElementById('doc').getBoundingClientRect().width);
  expect(largo).toBeGreaterThanOrEqual(280);
});

test('r6 l\'Impostazioni degli strumenti nel pannello ha la stessa cornice degli altri strumenti', async ({ app, openTab }) => {
  const ed = await openTab(EDITOR);
  await ed.waitForFunction(() => document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'settings' });
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'undo' });
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'apri' });
  await ed.waitForTimeout(500);
  const m = await ed.evaluate(() => Object.fromEntries(['settings', 'undo'].map((id) => {
    const n = document.querySelector(`.pd-elemento[data-elemento="${id}"] button`);
    const r = n.getBoundingClientRect();
    const c = n.closest('.pd-elemento').getBoundingClientRect();
    return [id, { sinistra: Math.round(r.left - c.left), destra: Math.round(c.right - r.right), sfondo: getComputedStyle(n).backgroundColor }];
  })));
  expect(m.settings).toEqual(m.undo);
});
