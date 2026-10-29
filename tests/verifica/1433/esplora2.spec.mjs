// Esplorazione del giro 4 (#1433): si cancella prima della consegna.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));
async function apriEditor(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('#doc');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  return ed;
}
const esegui = (app, a) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION(x), a);

test('H Aiuto aperto, pannello chiuso: la striscia si vede e si clicca?', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  await ed.click('#doc');
  await ed.keyboard.type('Testo.');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.waitForTimeout(600);
  const m = await ed.evaluate(() => {
    const s = document.querySelector('.pd-striscia').getBoundingClientRect();
    const x = s.left + s.width / 2;
    const y = 400;
    const sopra = document.elementFromPoint(x, y);
    return { s: JSON.parse(JSON.stringify(s)), sopra: sopra ? (sopra.className || sopra.tagName) : null, aiuto: JSON.parse(JSON.stringify(document.querySelector('.sn-sidebar').getBoundingClientRect())) };
  });
  console.log('STRISCIA CON AIUTO', JSON.stringify(m));
  await ed.screenshot({ path: 'tests/.shots/g4-aiuto-striscia.png' });
});

test('K a parole sul sito: il pannello non c\'è, cosa risponde Filo', async ({ app, openTab, server }) => {
  const p = await openTab(server ? `${server}/` : 'https://example.com/');
  await p.waitForTimeout(500);
  const r = await esegui(app, { type: 'PANNELLO_APP', operazione: 'apri' });
  console.log('SITO', JSON.stringify(r));
});

test('M due schede dell\'Editor: lo strumento aggiunto in una compare nell\'altra; bloccato in una, l\'altra', async ({ app, openTab }) => {
  const a = await apriEditor(openTab);
  const b = await apriEditor(openTab);
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'italic' });
  await expect(a.locator('.pd-elemento[data-elemento="italic"]')).toHaveCount(1);
  await expect(b.locator('.pd-elemento[data-elemento="italic"]')).toHaveCount(1);
});

test('N Escape nel campo Cerca: chiude il pannello, dove va il fuoco', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('il gatto e il cane');
  await ed.keyboard.press('Control+f');
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.keyboard.type('il');
  await expect(ed.locator('#doc mark.ed-find-hit')).toHaveCount(2);
  await ed.keyboard.press('Escape');
  await ed.waitForTimeout(400);
  const st = await ed.evaluate(() => ({ aperto: document.documentElement.classList.contains('pd-aperto'), fuoco: document.activeElement && (document.activeElement.id || document.activeElement.tagName), hits: document.querySelectorAll('#doc mark.ed-find-hit').length }));
  console.log('ESC', JSON.stringify(st));
  await ed.keyboard.type('X');
  console.log('DOC', await ed.locator('#doc').innerText());
});
