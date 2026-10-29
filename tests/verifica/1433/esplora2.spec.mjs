// Esplorazione del giro 7: si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const EDITOR = 'filo://editor/editor.html';
const SHOTS = 'tests/.shots/v1433';
mkdirSync(SHOTS, { recursive: true });

async function apriEditor(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('#doc');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  return ed;
}
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));
const elementi = (ed) => ed.evaluate(() => [...document.querySelectorAll('.pd-elementi > .pd-elemento')].map((n) => n.dataset.elemento));
const esegui = (app, a) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION(x), a);
const aiuto = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));

test('f1 Aiuto ridotto col ▾, poi pannello e lucchetto', async ({ app, openTab }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setContentSize(1280, 800));
  const ed = await apriEditor(openTab);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1' && typeof window.SN_SIDEBAR?.open === 'function');
  await ed.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = Array.from({ length: 30 }, () => '<p>Una riga di testo abbastanza lunga da arrivare fino al bordo destro della colonna centrale del foglio, e anche oltre.</p>').join('');
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await aiuto(app);
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.waitForTimeout(500);
  await ed.locator('.sn-sidebar-collapse').click();
  await ed.waitForTimeout(600);
  const a = await ed.evaluate(() => ({ cls: document.querySelector('.sn-sidebar').className, r: document.querySelector('.sn-sidebar').getBoundingClientRect().toJSON(), s: document.querySelector('.pd-striscia').getBoundingClientRect().toJSON(), doc: document.getElementById('doc').getBoundingClientRect().toJSON() }));
  console.log('RIDOTTO', JSON.stringify(a));
  await ed.screenshot({ path: `${SHOTS}/f1-ridotto.png` });
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.waitForTimeout(600);
  const b = await ed.evaluate(() => ({ p: document.querySelector('.pd-pannello').getBoundingClientRect().toJSON() }));
  console.log('PANNELLO CON RIDOTTO', JSON.stringify(b));
  await ed.screenshot({ path: `${SHOTS}/f1-ridotto-pannello.png` });
  await ed.click('.pd-lucchetto');
  await ed.waitForTimeout(600);
  const c = await ed.evaluate(() => ({ p: document.querySelector('.pd-pannello').getBoundingClientRect().toJSON(), doc: document.getElementById('doc').getBoundingClientRect().toJSON() }));
  console.log('BLOCCATO CON RIDOTTO', JSON.stringify(c));
  await ed.screenshot({ path: `${SHOTS}/f1-ridotto-bloccato.png` });
  // riapre l'Aiuto scrivendo
  await ed.click('.sn-sidebar-input textarea');
  await ed.waitForTimeout(600);
  const d = await ed.evaluate(() => ({ cls: document.querySelector('.sn-sidebar').className, p: document.querySelector('.pd-pannello').getBoundingClientRect().toJSON(), a: document.querySelector('.sn-sidebar').getBoundingClientRect().toJSON(), doc: document.getElementById('doc').getBoundingClientRect().toJSON() }));
  console.log('RIAPERTO', JSON.stringify(d));
  await ed.screenshot({ path: `${SHOTS}/f1-riaperto.png` });
});

test('f2 striscia nascosta dal tasto destro; preferenze', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.locator('.pd-striscia').click({ button: 'right', force: true });
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: `${SHOTS}/f2-menu-striscia.png` });
  await ed.getByText('Nascondi la striscia sul bordo').click();
  await ed.waitForTimeout(600);
  const s = await ed.evaluate(() => { const n = document.querySelector('.pd-striscia'); return { vis: getComputedStyle(n).display + '/' + getComputedStyle(n).opacity + '/' + getComputedStyle(n).visibility, r: n.getBoundingClientRect().toJSON() }; });
  console.log('STRISCIA NASCOSTA', JSON.stringify(s));
  const pref = await openTab('filo://preferences/preferences.html#sec-pannello');
  await pref.waitForSelector('#pannelloStriscia');
  await pref.waitForTimeout(800);
  console.log('PREF striscia', await pref.isChecked('#pannelloStriscia'), 'spinta', await pref.isChecked('#pannelloSpinta'), 'bloccato', await pref.isChecked('#pannelloBloccato'));
  await pref.check('#pannelloBloccato');
  await pref.waitForTimeout(800);
  console.log('EDITOR dopo blocco da pref', await ed.evaluate(() => document.documentElement.className));
  await pref.fill('#pannelloAttesa', '50');
  await pref.locator('#pannelloAttesa').blur();
  await pref.waitForTimeout(500);
  console.log('ATTESA salvata', JSON.stringify(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).pannelloDestro)));
  await pref.screenshot({ path: `${SHOTS}/f2-pref.png` });
});

test('f3 scorciatoia dell elemento: Ctrl+\\ e un tasto riservato', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(400);
  await ed.locator('.pd-elemento[data-elemento="comment"]').click({ button: 'right' });
  await ed.getByText('Impostazioni di «Commenta»…').click();
  await ed.waitForTimeout(500);
  await ed.screenshot({ path: `${SHOTS}/f3-impost-commenta.png` });
  const testo = await ed.evaluate(() => document.querySelector('#overlay')?.innerText);
  console.log('OVERLAY', JSON.stringify(testo));
});

test('f4 Ctrl+\\ dentro l Aiuto e con il focus nel campo Cerca', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1' && typeof window.SN_SIDEBAR?.open === 'function');
  await aiuto(app);
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.click('.sn-sidebar-input textarea');
  await ed.keyboard.press('Control+Backslash');
  await ed.waitForTimeout(500);
  console.log('CTRL\\ da Aiuto aperto?', await aperto(ed));
  await ed.keyboard.press('Control+f');
  await ed.waitForTimeout(500);
  console.log('CTRL+F da Aiuto: aperto', await aperto(ed), 'focus', await ed.evaluate(() => document.activeElement && (document.activeElement.dataset.sr || document.activeElement.tagName)));
});

test('f5 finestra ridimensionata con pannello bloccato', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = Array.from({ length: 4 }, () => '<p>Una riga di testo abbastanza lunga da arrivare fino al bordo destro della colonna centrale del foglio, e anche oltre.</p>').join('');
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'blocca' });
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-bloccato'))).toBe(true);
  for (const w of [1280, 900, 640, 520, 1100]) {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).setContentSize(w, 760), w);
    await ed.waitForTimeout(700);
    const m = await ed.evaluate(() => ({ iw: innerWidth, cls: document.documentElement.className, doc: Math.round(document.getElementById('doc').getBoundingClientRect().width), docR: Math.round(document.getElementById('doc').getBoundingClientRect().right), pan: Math.round(document.querySelector('.pd-pannello').getBoundingClientRect().left) }));
    console.log('W', w, JSON.stringify(m));
    await ed.screenshot({ path: `${SHOTS}/f5-${w}.png` });
  }
});

test('f6 Aiuto che formatta, poi Indietro del pannello', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const risponde = async ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, finishReason: 'stop' };
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: 'ok' };
      return { ...base, text: JSON.stringify({ text: 'Fatto.', formatta: [{ op: 'format', target: 'all', style: 'italic', value: true }] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = risponde;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = risponde;
  });
  const ed = await apriEditor(openTab);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'undo' });
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma');
  await aiuto(app);
  await ed.fill('.sn-sidebar-input textarea', 'metti tutto in corsivo');
  await ed.press('.sn-sidebar-input textarea', 'Enter');
  await expect(ed.locator('.sn-sidebar-msg-assistant').last()).toBeVisible();
  await ed.waitForTimeout(800);
  console.log('HTML dopo Aiuto', await ed.locator('#doc').innerHTML());
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.waitForTimeout(400);
  await ed.locator('.pd-elemento[data-elemento="undo"] button').first().click();
  await ed.waitForTimeout(500);
  console.log('HTML dopo Indietro', await ed.locator('#doc').innerHTML());
  await ed.keyboard.press('Control+z').catch(() => {});
});
