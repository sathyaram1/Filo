// #853.1 — La riga per la domanda successiva nel riquadro delle risposte è alta una riga, quanto il tasto di invio, su
// ogni pagina: il suggerimento ci sta in una riga senza frecce di scorrimento, e scrivendo la casella cresce senza
// barre finché non tocca il suo tetto.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { neiRiquadri, clicca, tastieraDi } from './helpers/riquadri.mjs';

const RISPOSTA = 'La fotosintesi trasforma la luce in zuccheri.';
// Una barra di scorrimento è larga almeno una decina di px; sotto i 4 è l'arrotondamento dei bordi a scala 125%.
const BARRA = 4;
const FRASE = 'La fotosintesi clorofilliana trasforma la luce in zuccheri.';

async function preparaModello(app) {
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.EXPLAIN]: 'deepseek-flash',
        [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash',
        [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origProvider8531 = globalThis.__origProvider8531 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origProvider8531,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta(t); return { text: t, usage: {} }; },
    };
  }, RISPOSTA);
}

const PAGINA_WEB = '<!doctype html><html><head><meta charset="utf-8"></head>'
  + `<body style="margin:0;padding:40px;font:16px sans-serif"><p id="bersaglio">${FRASE}</p></body></html>`;

async function apriEditor(openTab) {
  const page = await openTab('filo://editor/');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 15_000 });
  await page.evaluate((frase) => {
    const p = document.createElement('p');
    p.id = 'bersaglio';
    p.textContent = frase;
    p.style.cssText = 'position:fixed;left:40px;top:120px;z-index:2147480000;margin:0;padding:8px;'
      + 'font:16px sans-serif;background:#fff;color:#000';
    document.body.appendChild(p);
  }, FRASE);
  return page;
}

// I passi della segnalazione: seleziona la frase, tasto destro, freccetta dell'approfondimento.
async function apriRiquadroDaMenu(app, page) {
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#bersaglio'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#bersaglio').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline-explain .sn-menu-inline-body')).not.toHaveText(/Spiegazione…/, { timeout: 30_000 });
  await menu.locator('.sn-menu-inline-arrow').click();
  await expect.poll(() => misura(app, page), { timeout: 15_000 }).not.toBeNull();
}

function misura(app, page) {
  return neiRiquadri(app, page, () => {
    const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test;
    const trova = (s) => (T ? T.trova(s) : document.querySelector(s));
    const el = trova('.sn-popup-input');
    const invio = trova('.sn-popup-send');
    if (!el || !invio) return null;
    const cs = getComputedStyle(el);
    const px = (v) => parseFloat(v) || 0;
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontSize} system-ui, sans-serif`;
    return {
      alto: el.getBoundingClientRect().height,
      altoInvio: invio.getBoundingClientRect().height,
      // Frecce di scorrimento: contenuto (o suggerimento) che esce dalla casella in verticale.
      eccesso: el.scrollHeight - el.clientHeight,
      barra: el.offsetWidth - el.clientWidth - px(cs.borderLeftWidth) - px(cs.borderRightWidth),
      spazio: el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight),
      suggerimento: el.placeholder,
      larghezzaSuggerimento: ctx.measureText(el.placeholder).width,
      rigaPx: px(cs.lineHeight),
    };
  });
}

async function scriviNellaCasella(app, page, testo) {
  const dove = await clicca(app, page, '.sn-popup-input');
  await dove.keyboard.insertText(testo);
  return dove;
}

async function svuota(app, page) {
  const dove = await clicca(app, page, '.sn-popup-input');
  await dove.keyboard.press('Control+A');
  await dove.keyboard.press('Delete');
}

async function provaLaCasella(app, page, nome) {
  // Vuota: una riga sola, alta quanto il tasto di invio, suggerimento intero e niente frecce.
  const vuota = await misura(app, page);
  expect(vuota.suggerimento.trim().length).toBeGreaterThan(0);
  expect(vuota.eccesso).toBeLessThanOrEqual(0);
  expect(vuota.barra).toBeLessThan(BARRA);
  expect(Math.abs(vuota.alto - vuota.altoInvio)).toBeLessThanOrEqual(1);
  expect(vuota.larghezzaSuggerimento).toBeLessThan(vuota.spazio);
  // Il riquadro sta dove lo disegna Filo: nello strato sopra un sito, nella pagina su filo://.
  try { await (await tastieraDi(app, page)).screenshot({ path: `tests/.shots/popup-casella-${nome}-vuota.png` }); } catch (_) {}

  // Un suggerimento più largo della casella (riquadro stretto, testo più lungo) resta su una riga: niente frecce.
  const lungo = await neiRiquadri(app, page, () => {
    const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test;
    const el = T ? T.trova('.sn-popup-input') : document.querySelector('.sn-popup-input');
    const prima = el.placeholder;
    el.placeholder = 'Un suggerimento lunghissimo '.repeat(8);
    const eccesso = el.scrollHeight - el.clientHeight;
    const cs = getComputedStyle(el);
    const barra = el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    el.placeholder = prima;
    return { eccesso, barra };
  });
  expect(lungo.eccesso).toBeLessThanOrEqual(0);
  expect(lungo.barra).toBeLessThan(BARRA);

  // Una riga scritta: stessa altezza, niente frecce.
  const dove = await scriviNellaCasella(app, page, 'e in inglese?');
  await expect.poll(async () => (await misura(app, page)).alto).toBeGreaterThan(0);
  const una = await misura(app, page);
  expect(Math.abs(una.alto - vuota.alto)).toBeLessThanOrEqual(1);
  expect(una.eccesso).toBeLessThanOrEqual(0);
  expect(una.barra).toBeLessThan(BARRA);

  // Tre righe: la casella si allunga per tutte e tre, sempre senza frecce.
  await dove.keyboard.insertText('\nseconda riga\nterza riga');
  const tre = await misura(app, page);
  expect(tre.alto).toBeGreaterThanOrEqual(vuota.alto + 2 * tre.rigaPx - 1);
  expect(tre.eccesso).toBeLessThanOrEqual(0);
  expect(tre.barra).toBeLessThan(BARRA);
  try { await dove.screenshot({ path: `tests/.shots/popup-casella-${nome}-tre-righe.png` }); } catch (_) {}

  // Oltre il tetto la casella smette di crescere e scorre al suo interno.
  await dove.keyboard.insertText('\nriga'.repeat(20));
  const tante = await misura(app, page);
  expect(tante.alto).toBeLessThanOrEqual(121);
  expect(tante.eccesso).toBeGreaterThan(0);

  // Svuotata torna com'era.
  await svuota(app, page);
  await expect.poll(async () => (await misura(app, page)).alto).toBeLessThanOrEqual(vuota.alto + 1);
  const dopo = await misura(app, page);
  expect(dopo.eccesso).toBeLessThanOrEqual(0);
  expect(dopo.barra).toBeLessThan(BARRA);
}

test('#853.1 Editor: la riga per la domanda dopo sta in una riga, senza frecce', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app);
  const page = await apriEditor(openTab);
  await apriRiquadroDaMenu(app, page);
  await provaLaCasella(app, page, 'editor');
});

test('#853.1 pagina web: la riga per la domanda dopo sta in una riga, senza frecce', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await preparaModello(app);
  const page = await testServer.openReady(openTab, PAGINA_WEB);
  await apriRiquadroDaMenu(app, page);
  await provaLaCasella(app, page, 'web');
});

test('#853.1 Traduci da tastiera: stessa riga, senza frecce', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await preparaModello(app);
  const page = await testServer.openReady(openTab, PAGINA_WEB);
  await page.locator('#bersaglio').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__filoShortcuts.dispatch('translate-selection', BrowserWindow.getAllWindows().find((w) => w._filoTabs));
  });
  await expect.poll(() => misura(app, page), { timeout: 15_000 }).not.toBeNull();
  await provaLaCasella(app, page, 'traduci');
});
