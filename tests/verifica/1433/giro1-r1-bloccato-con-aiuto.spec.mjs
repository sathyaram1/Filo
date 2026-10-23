// Verifica #1433, giro 1, rilievo 1: il pannello bloccato spinge il foglio anche quando l'Aiuto è aperto accanto.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

test('r1 bloccato, con l\'Aiuto aperto il pannello non copre il testo del foglio', async ({ app, openTab }) => {
  const ed = await openTab(EDITOR);
  await ed.waitForFunction(() => document.querySelector('.pd-elemento[data-elemento="word-count"]') && document.documentElement.dataset.filoContentScripts === '1');
  await ed.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = Array.from({ length: 12 }, () => '<p>Una riga di testo abbastanza lunga da arrivare fino al bordo destro della colonna centrale del foglio, e anche oltre.</p>').join('');
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.click('.pd-lucchetto');
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-bloccato'))).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.waitForTimeout(500);
  const m = await ed.evaluate(() => ({
    testo: document.getElementById('doc').getBoundingClientRect().right,
    pannello: document.querySelector('.pd-pannello').getBoundingClientRect().left,
    pannelloDestra: document.querySelector('.pd-pannello').getBoundingClientRect().right,
    aiuto: document.querySelector('.sn-sidebar').getBoundingClientRect().left,
  }));
  expect(m.pannelloDestra, 'il pannello sta alla sinistra dell\'Aiuto').toBeLessThanOrEqual(m.aiuto + 1);
  expect(m.testo, 'il testo finisce prima del pannello: bloccato spinge, non copre').toBeLessThanOrEqual(m.pannello);
});
