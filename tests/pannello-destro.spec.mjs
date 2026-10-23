// #1433 — L'Editor senza griglia: foglio a tutta larghezza, strumenti nel pannello che si apre dal bordo destro, chat
// come Aiuto. Qui i gesti di Playwright (clic, tasti, trascinamenti nella pagina); il bordo col puntatore vero sta in
// tests/pannello-destro-bordo.spec.mjs. Modello finto nel main: il resto è il codice vero.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR = 'filo://editor/editor.html';
const SHOTS = 'tests/.shots';

async function apriEditor(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('#doc');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  return ed;
}
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));
const elementi = (ed) => ed.evaluate(() => [...document.querySelectorAll('.pd-elementi > .pd-elemento')].map((n) => n.dataset.elemento));

async function premi(app, key, modifiers = []) {
  await app.evaluate(({ BrowserWindow }, { key, modifiers }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const t = win._filoTabs.tabs.find((x) => x.id === win._filoTabs.activeId);
    const wc = t.view.webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
  }, { key, modifiers });
}

test('l\'Editor non ha più griglia né splitter: il foglio prende tutta la larghezza, il testo resta al centro', async ({ openTab }) => {
  const ed = await apriEditor(openTab);
  const m = await ed.evaluate(() => {
    const wrap = document.getElementById('docWrap').getBoundingClientRect();
    const docR = document.getElementById('doc').getBoundingClientRect();
    return {
      griglia: !!document.querySelector('#grid, .ed-grid, #splitter, .ed-splitter, #sidebar, .ed-module, #settingsView'),
      larghezza: wrap.width, finestra: window.innerWidth,
      centro: (docR.left + docR.right) / 2,
    };
  });
  expect(m.griglia).toBe(false);
  expect(m.larghezza).toBeGreaterThan(m.finestra - 2);
  // La colonna di testo è centrata nel foglio (la barra di scorrimento a destra sposta il centro di qualche pixel).
  expect(Math.abs(m.centro - m.finestra / 2)).toBeLessThan(16);
  expect(await aperto(ed)).toBe(false);
  expect(await elementi(ed)).toEqual(['word-count', 'search-replace', 'comment']);
});

test('il conteggio nel pannello cambia scrivendo; Ctrl+\\ apre e chiude il pannello; un clic sul foglio lo chiude', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('uno due tre');
  await expect(ed.locator('.pd-elemento[data-elemento="word-count"] .wc-num')).toHaveText('3');
  await ed.keyboard.type(' quattro');
  await expect(ed.locator('.pd-elemento[data-elemento="word-count"] .wc-num')).toHaveText('4');

  await premi(app, '\\', ['control']);
  await expect.poll(() => aperto(ed)).toBe(true);
  await expect(ed.locator('.pd-pannello')).toBeVisible();
  const vw = await ed.evaluate(() => window.innerWidth);
  // Finito di scivolare dentro, il pannello sta alla sinistra della barra di scorrimento.
  await expect.poll(async () => { const b = await ed.locator('.pd-pannello').boundingBox(); return b.x + b.width; }).toBeLessThan(vw - 4);
  await premi(app, '\\', ['control']);
  await expect.poll(() => aperto(ed)).toBe(false);

  await premi(app, '\\', ['control']);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.mouse.click(200, 300);
  await expect.poll(() => aperto(ed)).toBe(false);
});

test('Ctrl+F apre il pannello sul campo di Cerca e sostituisci, e la ricerca trova nel foglio', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('il gatto e il cane');
  await premi(app, 'F', ['control']);
  await expect.poll(() => aperto(ed)).toBe(true);
  await expect(ed.locator('.pd-elemento[data-elemento="search-replace"] [data-sr="find"]')).toBeFocused();
  await ed.keyboard.type('il');
  await expect(ed.locator('#doc mark.ed-find-hit')).toHaveCount(2);
});

test('il lucchetto tiene aperto il pannello e il foglio si restringe; sbloccato si apre sopra senza spostare il testo', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('Testo di prova abbastanza lungo da riempire una riga della colonna centrale del foglio.');
  const destroTesto = () => ed.evaluate(() => document.getElementById('doc').getBoundingClientRect().right);
  const prima = await destroTesto();

  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(400);
  expect(await destroTesto(), 'sbloccato il pannello copre, il testo non si sposta').toBe(prima);

  await ed.click('.pd-lucchetto');
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-bloccato'))).toBe(true);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).pannelloDestro.bloccato)).toBe(true);
  await ed.waitForTimeout(400);
  const pan = await ed.locator('.pd-pannello').boundingBox();
  expect(await destroTesto(), 'bloccato il foglio si stringe e il testo resta a sinistra del pannello').toBeLessThanOrEqual(pan.x);
  // Bloccato, un clic sul foglio non lo chiude.
  await ed.mouse.click(150, 300);
  await ed.waitForTimeout(300);
  expect(await aperto(ed)).toBe(true);
  mkdirSync(SHOTS, { recursive: true });
  await ed.screenshot({ path: `${SHOTS}/pannello-destro-bloccato.png` });

  await ed.click('.pd-lucchetto');
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-bloccato'))).toBe(false);
  await ed.mouse.click(150, 300);
  await expect.poll(() => aperto(ed)).toBe(false);
});

test('il «+» mostra tutti gli strumenti: uno trascinato dentro resta dopo il riavvio, uno tolto sparisce', async () => {
  test.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-pannello-');
  const env = { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' };
  const avvia = async () => {
    const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env });
    const shell = await primaFinestra(app);
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), EDITOR);
    let ed = null;
    await expect.poll(() => Boolean(ed = app.windows().find((w) => { try { return w.url().startsWith(EDITOR); } catch (_) { return false; } })), { timeout: 15_000 }).toBe(true);
    await ed.waitForSelector('.pd-elemento[data-elemento="word-count"]', { state: 'attached' });
    return { app, ed };
  };
  try {
    let { app, ed } = await avvia();
    await ed.evaluate(() => document.querySelector('.pd-striscia').click());
    await expect.poll(() => aperto(ed)).toBe(true);
    await ed.click('.pd-piu');
    await expect(ed.locator('.pd-catalogo')).toBeVisible();
    await expect(ed.locator('.pd-catalogo .pd-voce[data-elemento="bold"]')).toBeVisible();
    mkdirSync(SHOTS, { recursive: true });
    await ed.screenshot({ path: `${SHOTS}/pannello-destro-espanso.png` });

    // Il grassetto trascinato fra Conteggio e Cerca e sostituisci.
    const voce = await ed.locator('.pd-catalogo .pd-voce[data-elemento="bold"]').boundingBox();
    const meta = await ed.locator('.pd-elemento[data-elemento="search-replace"]').boundingBox();
    await ed.mouse.move(voce.x + voce.width / 2, voce.y + voce.height / 2);
    await ed.mouse.down();
    await ed.mouse.move(voce.x + 20, voce.y - 20, { steps: 4 });
    await ed.mouse.move(meta.x + meta.width / 2, meta.y + 6, { steps: 8 });
    await ed.mouse.up();
    await expect.poll(() => elementi(ed)).toEqual(['word-count', 'bold', 'search-replace', 'comment']);

    // Il commento trascinato fuori dal pannello se ne va.
    const cm = await ed.locator('.pd-elemento[data-elemento="comment"]').boundingBox();
    await ed.mouse.move(cm.x + cm.width / 2, cm.y + cm.height / 2);
    await ed.mouse.down();
    await ed.mouse.move(cm.x - 40, cm.y + 10, { steps: 4 });
    await ed.mouse.move(200, 300, { steps: 8 });
    await ed.mouse.up();
    await expect.poll(() => elementi(ed)).toEqual(['word-count', 'bold', 'search-replace']);
    await expect(ed.locator('.pd-catalogo .pd-voce[data-elemento="comment"]')).toBeVisible();

    await chiudiApp(app);
    ({ app, ed } = await avvia());
    await expect.poll(() => elementi(ed)).toEqual(['word-count', 'bold', 'search-replace']);
    // Il grassetto del pannello mette davvero il grassetto.
    await ed.click('#doc');
    await ed.keyboard.type('forte');
    await ed.keyboard.press('Control+A');
    await ed.evaluate(() => document.querySelector('.pd-striscia').click());
    await ed.locator('.pd-elemento[data-elemento="bold"] .ed-fmt-btn').dispatchEvent('mousedown', { button: 0 });
    await expect(ed.locator('#doc b, #doc strong')).toHaveText('forte');
    // Col tasto destro si toglie.
    await ed.click('.pd-elemento[data-elemento="bold"] .pd-contenuto', { button: 'right' });
    await ed.locator('.pd-menu .sn-select-option', { hasText: 'Togli dal pannello' }).click();
    await expect.poll(() => elementi(ed)).toEqual(['word-count', 'search-replace']);
    await chiudiApp(app);
  } finally {
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('la chat è l\'Aiuto: vede il documento e una richiesta ne cambia la formattazione, annullabile', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__aiutoVisto = [];
    const risponde = async ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, finishReason: 'stop' };
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: 'ok' };
      globalThis.__aiutoVisto.push(sistema);
      return { ...base, text: JSON.stringify({ text: 'Fatto: titoli in grassetto.', formatta: [{ op: 'format', target: 'headings', style: 'bold', value: true }] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = risponde;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = risponde;
  });
  const ed = await apriEditor(openTab);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1' && typeof window.SN_SIDEBAR?.open === 'function');
  await ed.evaluate(() => {
    document.getElementById('doc').innerHTML = '<h1>Capitolo primo</h1><p>Il testo del capitolo segreto.</p>';
    document.getElementById('doc').dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Dall'icona Aiuto della barra laterale, come l'utente.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    win._filoTabs.barra.esegui('help');
  });
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await expect(ed.locator('.sn-sidebar-input textarea')).toHaveAttribute('placeholder', 'Chiedi al documento…');
  await ed.fill('.sn-sidebar-input textarea', 'metti in grassetto i titoli');
  await ed.press('.sn-sidebar-input textarea', 'Enter');
  await expect(ed.locator('.sn-sidebar-msg-assistant').last()).toContainText('titoli in grassetto');
  await expect.poll(() => ed.evaluate(() => {
    const h = document.querySelector('#doc h1');
    return !!(h && (h.querySelector('b, strong') || /bold|700/.test(getComputedStyle(h.querySelector('span, b, strong') || h).fontWeight)));
  })).toBe(true);
  const visto = await app.evaluate(() => globalThis.__aiutoVisto.join('\n'));
  expect(visto).toContain('Il testo del capitolo segreto.');
  expect(visto).toContain('"formatta"');
  // La modifica di Filo è annullabile.
  await expect(ed.locator('.ed-toast-action', { hasText: 'Annulla' })).toBeVisible();

  // Aiuto e pannello aperti insieme: il pannello sta alla sinistra dell'Aiuto.
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(350);
  const aiuto = await ed.locator('.sn-sidebar').boundingBox();
  const pan = await ed.locator('.pd-pannello').boundingBox();
  expect(pan.x + pan.width).toBeLessThanOrEqual(aiuto.x + 1);
  mkdirSync(SHOTS, { recursive: true });
  await ed.screenshot({ path: `${SHOTS}/pannello-destro-con-aiuto.png` });
});

test('l\'Aiuto dell\'Editor si apre anche dal tasto destro sul foglio', async ({ openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  await ed.click('#doc');
  await ed.keyboard.type('una riga');
  await ed.locator('#doc').click({ button: 'right' });
  await menuDi(ed).voce('Aiuto').first().click();
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await expect(ed.locator('.sn-sidebar-input textarea')).toHaveAttribute('placeholder', 'Chiedi al documento…');
});

test('a parole: Filo apre il pannello, ci mette e toglie uno strumento, lo blocca', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  const esegui = (azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);
  let r = await esegui({ type: 'PANNELLO_APP', operazione: 'apri' });
  expect(r.executed).toBe(true);
  await expect.poll(() => aperto(ed)).toBe(true);
  r = await esegui({ type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'corsivo' });
  expect(r.executed).toBe(true);
  await expect.poll(() => elementi(ed)).toEqual(['word-count', 'search-replace', 'comment', 'italic']);
  r = await esegui({ type: 'PANNELLO_APP', operazione: 'togli', elemento: 'conteggio' });
  await expect.poll(() => elementi(ed)).toEqual(['search-replace', 'comment', 'italic']);
  r = await esegui({ type: 'PANNELLO_APP', operazione: 'blocca' });
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-bloccato'))).toBe(true);
  r = await esegui({ type: 'PANNELLO_APP', operazione: 'sblocca' });
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-bloccato'))).toBe(false);
  r = await esegui({ type: 'PANNELLO_APP', operazione: 'chiudi' });
  await expect.poll(() => aperto(ed)).toBe(false);
});

test('i vecchi moduli: il conteggio dei caratteri e la scorciatoia passano allo strumento, la griglia sparisce dai documenti', async ({ app, openTab }) => {
  const ed0 = await openTab(EDITOR);
  await ed0.waitForSelector('#doc');
  await ed0.evaluate(() => {
    localStorage.setItem('filo.editor.collection', JSON.stringify({
      version: 2, activeId: 'f1',
      files: [{
        id: 'f1', meta: { title: 'Vecchio', created: '2026-01-01T00:00:00Z', modified: '2026-01-02T00:00:00Z', version: 1, grid: { cols: 9, rows: 12 } },
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo' }] }] },
        comments: [],
        modules: [
          { id: 'm1', type: 'word-count', cells: [{ x: 0, y: 0, z: 0 }], data: { count: 'chars', shortcut: 'Ctrl+Shift+7' } },
          { id: 'm2', type: 'chat', cells: [{ x: 0, y: 3, z: 1 }], data: { messages: [] } },
        ],
      }],
    }));
  });
  await ed0.reload();
  await ed0.waitForSelector('.pd-elemento[data-elemento="word-count"]', { state: 'attached' });
  await expect(ed0.locator('#doc')).toContainText('ciao mondo');
  await expect(ed0.locator('.pd-elemento[data-elemento="word-count"] .wc-cap')).toHaveText('caratteri');
  await expect(ed0.locator('.pd-elemento[data-elemento="word-count"] .wc-num')).toHaveText('10');
  await expect.poll(() => ed0.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('filo.editor.collection'));
    return c.files.every((f) => (!f.modules || !f.modules.length) && !(f.meta && f.meta.grid));
  })).toBe(true);
  const salvato = await app.evaluate(async () => (await globalThis.SN_STORAGE.getRaw('sn_pannelli_app', null)));
  expect(salvato.editor.config['word-count']).toMatchObject({ count: 'chars', shortcut: 'Ctrl+Shift+7' });
});
