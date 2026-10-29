// #1433 giro 7, rilievo 1: con l'Aiuto ridotto alla sola casella, il pannello degli strumenti si apre sul bordo destro,
// non a metà finestra dove comincerebbe l'Aiuto intero.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

test('r1 con l\'Aiuto ridotto alla casella, la striscia e il pannello stanno sul bordo destro', async ({ app, openTab }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setContentSize(1280, 800));
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('.pd-elemento[data-elemento="word-count"]', { state: 'attached' });
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1' && typeof window.SN_SIDEBAR?.open === 'function');
  await ed.click('#doc');
  await ed.keyboard.type('Una riga di testo nel foglio.');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.waitForTimeout(500);
  await ed.locator('.sn-sidebar-collapse').click();
  await expect(ed.locator('.sn-sidebar.sn-sidebar-collapsed')).toHaveCount(1);
  await ed.waitForTimeout(500);

  const striscia = await ed.evaluate(() => ({ destra: document.querySelector('.pd-striscia').getBoundingClientRect().right, finestra: innerWidth }));
  expect(striscia.destra, 'la striscia sul bordo destro').toBeGreaterThan(striscia.finestra - 40);

  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'))).toBe(true);
  await ed.waitForTimeout(500);
  const m = await ed.evaluate(() => ({
    pannello: document.querySelector('.pd-pannello').getBoundingClientRect().toJSON(),
    casella: document.querySelector('.sn-sidebar').getBoundingClientRect().toJSON(),
    finestra: innerWidth,
  }));
  expect(m.pannello.right, 'il pannello si apre contro il bordo destro').toBeGreaterThan(m.finestra - 40);
  const sovrapposti = m.pannello.left < m.casella.right && m.pannello.right > m.casella.left
    && m.pannello.top < m.casella.bottom && m.pannello.bottom > m.casella.top;
  expect(sovrapposti, 'e non copre la casella dell\'Aiuto').toBe(false);
});
