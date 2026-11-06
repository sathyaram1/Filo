// #1447.3 — nelle finestre in incognito il correttore nativo segna le parole italiane come in quella normale.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<title>CORRETTORE</title>
<style>body{margin:0;padding:20px} textarea{font:20px/30px monospace;padding:0;border:0;margin:0;width:900px;height:200px;outline:0;resize:none}</style>
<textarea id="t" spellcheck="true"></textarea>`;

const idIncognito = (app) => app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().filter((w) => w._filoIncognito).map((w) => w.id));

async function apriIncognito(app, shell) {
  const prima = await idIncognito(app);
  await shell.evaluate(() => window.filoShell.openIncognito());
  let nuova = null;
  await expect.poll(async () => {
    nuova = (await idIncognito(app)).find((id) => !prima.includes(id)) ?? null;
    return nuova;
  }, { timeout: 15_000 }).not.toBeNull();
  return nuova;
}

async function trovaPagina(app, url, tetto = 15_000) {
  const fine = Date.now() + tetto;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`pagina non trovata: ${url}`);
}

async function apriInIncognito(app, id, url) {
  await app.evaluate(({ BrowserWindow }, a) => { BrowserWindow.fromId(a.id)._filoTabs.openTab(a.url); }, { id, url });
  return trovaPagina(app, url);
}

// Tasto destro sulla parola: la parola che il correttore segna sotto il cursore, come la vede il menu.
async function segnata(app, page, url, testo, parola) {
  const p = await page.evaluate(({ testo, parola }) => {
    const t = document.getElementById('t');
    const c = document.createElement('canvas').getContext('2d');
    c.font = getComputedStyle(t).font;
    const w = c.measureText('m').width;
    const r = t.getBoundingClientRect();
    const i = testo.indexOf(parola);
    return { x: Math.round(r.left + (i + parola.length / 2) * w), y: Math.round(r.top + 15) };
  }, { testo, parola });
  return app.evaluate(({ webContents }, a) => new Promise((res) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === a.url);
    if (!wc) return res({ errore: 'nessuna scheda' });
    const fatto = (_e, params) => res({ parola: params.misspelledWord, suggerimenti: params.dictionarySuggestions });
    wc.once('context-menu', fatto);
    wc.sendInputEvent({ type: 'mouseDown', x: a.x, y: a.y, button: 'right', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: a.x, y: a.y, button: 'right', clickCount: 1 });
    setTimeout(() => { wc.removeListener('context-menu', fatto); res({ errore: 'nessun menu' }); }, 3000);
  }), { url, ...p });
}

async function prova(app, page, url, testo) {
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 }).catch(() => {});
  await page.click('#t');
  await page.keyboard.type(testo + ' ', { delay: 10 });
  // Il segno arriva dopo la scrittura: si aspetta che la parola di controllo, inventata, sia segnata.
  await expect.poll(async () => (await segnata(app, page, url, testo, 'qwzxv')).parola, { timeout: 20_000 }).toBe('qwzxv');
  await page.keyboard.press('Escape').catch(() => {});
  const esiti = {};
  for (const parola of testo.split(' ').filter((p) => p !== 'qwzxv')) {
    esiti[parola] = (await segnata(app, page, url, testo, parola)).parola || '';
    await page.keyboard.press('Escape').catch(() => {});
  }
  return esiti;
}

const TESTI = ['ok ci vediamo qwzxv', 'si va bene qwzxv', 'domani mattina andiamo al mercato qwzxv'];

for (const testo of TESTI) {
  test(`in incognito non segna le parole italiane: «${testo}»`, async ({ app, shell, testServer, openTab }) => {
    test.setTimeout(120_000);
    const base = testServer.html(PAGINA);
    const normale = `${base}?w=normale`;
    const esitiNormale = await prova(app, await openTab(normale), normale, testo);
    const id = await apriIncognito(app, shell);
    const inc = `${base}?w=incognito`;
    const esitiInc = await prova(app, await apriInIncognito(app, id, inc), inc, testo);
    const lingue = await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)._filoTabs && require('electron').session.fromPartition(BrowserWindow.fromId(id)._filoTabs.partition).getSpellCheckerLanguages(), id).catch((e) => String(e));
    console.log(JSON.stringify({ testo, esitiNormale, esitiInc, lingue }));
    const pulite = Object.fromEntries(Object.keys(esitiInc).map((k) => [k, '']));
    expect(esitiNormale).toEqual(pulite);
    expect(esitiInc).toEqual(pulite);
  });
}
