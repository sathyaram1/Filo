// Esplorazione del verificatore #1433: si rinomina o si cancella prima di registrare.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const EDITOR = 'filo://editor/editor.html';
const SHOTS = 'tests/.shots';

async function apriEditor(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('#doc');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  return ed;
}
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));

test('bloccato con l\'Aiuto aperto: il pannello non copre il testo', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  await ed.evaluate(() => {
    document.getElementById('doc').innerHTML = Array.from({ length: 12 }, () => '<p>Una riga di testo abbastanza lunga da arrivare fino al bordo destro della colonna centrale del foglio, e anche oltre.</p>').join('');
    document.getElementById('doc').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.click('.pd-lucchetto');
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-bloccato'))).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    win._filoTabs.barra.esegui('help');
  });
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.waitForTimeout(600);
  mkdirSync(SHOTS, { recursive: true });
  await ed.screenshot({ path: `${SHOTS}/v1433-bloccato-aiuto.png` });
  const m = await ed.evaluate(() => ({
    w: window.innerWidth,
    testo: document.getElementById('doc').getBoundingClientRect().right,
    testoL: document.getElementById('doc').getBoundingClientRect().left,
    pannello: document.querySelector('.pd-pannello').getBoundingClientRect().left,
    pannelloR: document.querySelector('.pd-pannello').getBoundingClientRect().right,
    aiuto: document.querySelector('.sn-sidebar').getBoundingClientRect().left,
  }));
  console.log('MISURE', JSON.stringify(m));
  expect(m.testo).toBeLessThanOrEqual(m.pannello);
});

test('tema scuro: pannello aperto ed espanso', async ({ app, openTab }) => {
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('Testo di prova nel tema scuro.');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(400);
  mkdirSync(SHOTS, { recursive: true });
  await ed.screenshot({ path: `${SHOTS}/v1433-scuro-aperto.png` });
  await ed.click('.pd-piu');
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: `${SHOTS}/v1433-scuro-espanso.png` });
  // Tutti gli strumenti dentro: come stanno.
  for (const id of ['text-size', 'align', 'font', 'undo', 'redo', 'settings', 'bold', 'italic', 'underline']) {
    await ed.evaluate((i) => window.SN_PANNELLO_DESTRO && 0, id);
  }
});

test('il conteggio si configura dal suo tasto destro e conta i caratteri', async ({ openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('ciao mondo');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.click('.pd-elemento[data-elemento="word-count"] .pd-contenuto', { button: 'right' });
  await ed.screenshot({ path: `${SHOTS}/v1433-wc-menu.png` });
  await ed.locator('.pd-menu .sn-select-option', { hasText: 'Impostazioni' }).click();
  await ed.waitForTimeout(400);
  await ed.screenshot({ path: `${SHOTS}/v1433-wc-config.png` });
  console.log('OVERLAY', await ed.evaluate(() => document.getElementById('overlay')?.innerText));
  console.log('APERTO DOPO CONFIG', await aperto(ed));
});
