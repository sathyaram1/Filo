// Esplorazione del giro 6 (si cancella prima della registrazione).
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { EDITOR, strumento, pannelloAperto, apriPannello, apriAiuto } from '../../helpers/strumentiEditor.mjs';

const SHOTS = 'tests/.shots/v1433g6';
const elementi = (ed) => ed.evaluate(() => [...document.querySelectorAll('.pd-elementi > .pd-elemento')].map((n) => n.dataset.elemento));
async function apriEditor(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('#doc');
  await ed.waitForSelector('.pd-elemento[data-elemento="word-count"]', { state: 'attached' });
  return ed;
}
const tema = (app, t) => app.evaluate(async (_e, t) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { theme: t } }, { url: 'filo://preferences/preferences.html' }), t);

for (const t of ['light', 'dark']) {
  test(`foto ${t}`, async ({ app, openTab }) => {
    mkdirSync(SHOTS, { recursive: true });
    await tema(app, t);
    const ed = await apriEditor(openTab);
    await ed.click('#doc');
    await ed.keyboard.type('Un titolo di prova\nUn paragrafo abbastanza lungo da occupare la colonna di testo del foglio e andare a capo almeno una volta, per vedere dove finisce.');
    await ed.waitForTimeout(500);
    await ed.screenshot({ path: `${SHOTS}/${t}-chiuso.png` });
    await ed.evaluate(() => document.querySelector('.pd-striscia').click());
    await ed.waitForTimeout(600);
    await ed.screenshot({ path: `${SHOTS}/${t}-aperto.png` });
    await ed.click('.pd-piu');
    await ed.waitForTimeout(400);
    await ed.screenshot({ path: `${SHOTS}/${t}-espanso.png` });
    await ed.click('.pd-piu');
    await ed.click('.pd-lucchetto');
    await ed.waitForTimeout(600);
    await ed.screenshot({ path: `${SHOTS}/${t}-bloccato.png` });
    await apriAiuto(app, ed);
    await ed.waitForTimeout(600);
    await ed.screenshot({ path: `${SHOTS}/${t}-bloccato-aiuto.png` });
    // striscia: menu col tasto destro
    await ed.click('.pd-lucchetto');
  });
}

test('due schede', async ({ app, openTab }) => {
  const a = await apriEditor(openTab);
  const b = await apriEditor(openTab);
  await a.bringToFront();
  await apriPannello(a);
  await a.click('.pd-piu');
  await a.click('.pd-catalogo .pd-voce[data-elemento="italic"]');
  await expect.poll(() => elementi(a)).toContain('italic');
  await expect.poll(() => elementi(b)).toContain('italic');
  await a.click('.pd-lucchetto');
  await expect.poll(() => b.evaluate(() => document.documentElement.classList.contains('pd-bloccato'))).toBe(true);
  console.log('B aperto', await pannelloAperto(b));
});

test('menu catalogo e strumento', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await apriPannello(ed);
  await ed.click('.pd-piu');
  await ed.click('.pd-catalogo .pd-voce[data-elemento="undo"]', { button: 'right' });
  console.log('menu voce', await ed.locator('.pd-menu .sn-select-option').allTextContents());
  await ed.keyboard.press('Escape');
  await ed.click('.pd-elemento[data-elemento="word-count"] .pd-contenuto', { button: 'right' });
  console.log('menu strumento', await ed.locator('.pd-menu .sn-select-option').allTextContents());
  await ed.keyboard.press('Escape');
  console.log('aperto dopo esc menu', await pannelloAperto(ed));
  await ed.evaluate(() => document.querySelector('.pd-striscia').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 1000, clientY: 300 })));
  console.log('menu striscia', await ed.locator('.pd-menu .sn-select-option').allTextContents());
});

test('indietro dal pannello', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await apriPannello(ed);
  await ed.click('.pd-piu');
  await ed.click('.pd-catalogo .pd-voce[data-elemento="undo"]');
  await ed.click('.pd-catalogo .pd-voce[data-elemento="redo"]');
  await ed.click('.pd-catalogo .pd-voce[data-elemento="align"]');
  await ed.click('.pd-catalogo .pd-voce[data-elemento="font-size"]');
  await ed.click('.pd-catalogo .pd-voce[data-elemento="font"]');
  await ed.click('.pd-piu');
  await ed.click('#doc');
  await ed.keyboard.type('prima parola');
  await ed.waitForTimeout(800);
  await ed.keyboard.type(' seconda');
  await ed.waitForTimeout(800);
  console.log('html undo', await ed.locator('.pd-elemento[data-elemento="undo"]').innerHTML());
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.waitForTimeout(400);
  const btn = ed.locator('.pd-elemento[data-elemento="undo"] button').first();
  await btn.click();
  await ed.waitForTimeout(300);
  console.log('dopo indietro', await ed.locator('#doc').innerText(), 'aperto', await pannelloAperto(ed));
  mkdirSync(SHOTS, { recursive: true });
  await ed.screenshot({ path: `${SHOTS}/strumenti-tutti.png` });
});

test('esc e scorciatoia su sito', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.press('Control+Backslash');
  await expect.poll(() => pannelloAperto(ed)).toBe(true);
  await ed.keyboard.press('Escape');
  await ed.waitForTimeout(300);
  console.log('dopo esc', await pannelloAperto(ed), 'focus', await ed.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.className)));
});

test('preferenze', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  const pr = await openTab('filo://preferences/preferences.html#sec-pannello');
  await pr.waitForSelector('#pannelloStriscia');
  await pr.waitForTimeout(800);
  console.log('valori', await pr.evaluate(() => ({ s: document.getElementById('pannelloStriscia').checked, p: document.getElementById('pannelloSpinta').checked, b: document.getElementById('pannelloBloccato').checked, a: document.getElementById('pannelloAttesa').value, u: document.getElementById('pannelloUscita').value })));
  await pr.click('#pannelloStriscia');
  await pr.fill('#pannelloAttesa', '50');
  await pr.press('#pannelloAttesa', 'Tab');
  await pr.waitForTimeout(800);
  console.log('dopo', await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).pannelloDestro), await pr.evaluate(() => document.getElementById('pannelloAttesa').value));
  console.log('ed senza striscia', await ed.evaluate(() => document.documentElement.classList.contains('pd-senza-striscia')), await ed.evaluate(() => getComputedStyle(document.querySelector('.pd-striscia')).display + '/' + getComputedStyle(document.querySelector('.pd-striscia')).opacity));
  mkdirSync(SHOTS, { recursive: true });
  await pr.screenshot({ path: `${SHOTS}/preferenze.png` });
});
