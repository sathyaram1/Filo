// #853 — sulle pagine interne di Filo (tranne la home) le risposte del tasto
// destro devono apparire come sulle pagine web: grassetto e link resi, e un tag
// HTML scritto dal modello si legge come testo, non diventa un elemento.
// Senza la correzione: nessun grassetto (asterischi a vista) e l'<img> del
// modello entra nella pagina e va a chiedere l'indirizzo esterno.

import { test, expect } from './fixtures/electron.mjs';

const OSTILE = 'filo-853.invalid';
const RISPOSTA_BELLA = 'Il **grassetto** resta, e la [guida](https://example.com/guida) si apre.';
const RISPOSTA_OSTILE = `Codice: <img id="spia" src="https://${OSTILE}/spia.png"> e `
  + `<form id="modulo" action="https://${OSTILE}/f"><button>Invia</button></form> fine.`;

// Il modello finto: `complete` per la spiegazione nel menu, `streamComplete`
// (a pezzi, con una pausa) per il riquadro di Approfondisci.
async function preparaModello(app, testo) {
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origProvider853 = globalThis.__origProvider853 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origProvider853,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
      streamComplete: async ({ onDelta }) => {
        const meta = Math.floor(t.length / 2);
        onDelta(t.slice(0, meta));
        await new Promise((r) => setTimeout(r, 600));
        onDelta(t.slice(meta));
        return { text: t, usage: {} };
      },
    };
  }, testo);
}

// Registra ogni elemento che punta all'indirizzo ostile, anche se compare solo
// per un attimo durante lo streaming.
async function sorvegliaPagina(page) {
  await page.evaluate((host) => {
    window.__ostili853 = [];
    const guarda = (n) => {
      if (!n || n.nodeType !== 1) return;
      for (const el of [n, ...n.querySelectorAll('*')]) {
        const dove = `${el.getAttribute('src') || ''} ${el.getAttribute('action') || ''}`;
        if (dove.includes(host) || ['spia', 'modulo'].includes(el.id)) window.__ostili853.push(el.tagName);
      }
    };
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) guarda(n);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }, OSTILE);
}

async function apriPagina(openTab, url) {
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 15_000 });
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'bersaglio853';
    p.textContent = 'La fotosintesi clorofilliana trasforma la luce in zuccheri.';
    p.style.cssText = 'position:fixed;left:40px;top:120px;z-index:2147480000;margin:0;padding:8px;'
      + 'font:16px sans-serif;background:#fff;color:#000';
    document.body.appendChild(p);
  });
  return page;
}

// I passi dell'utente: seleziona, tasto destro, legge la spiegazione nel menu;
// poi la freccia apre il riquadro di Approfondisci.
async function selezionaEApriMenu(page) {
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#bersaglio853'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#bersaglio853').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  const corpo = menu.locator('.sn-menu-inline-explain .sn-menu-inline-body');
  await expect(corpo).not.toHaveText(/Spiegazione…/, { timeout: 30_000 });
  return { menu, corpo };
}

async function apriRiquadro(page, menu) {
  await menu.locator('.sn-menu-inline-arrow').click();
  const corpo = page.locator('.sn-popup .sn-popup-body');
  await expect(corpo).toBeVisible({ timeout: 15_000 });
  return corpo;
}

for (const [nome, url] of [['Editor', 'filo://editor/'], ['Gestione', 'filo://manage/manage.html']]) {
  test(`#853 ${nome}: grassetto e link resi nel menu e nel riquadro`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    const page = await apriPagina(openTab, url);
    await preparaModello(app, RISPOSTA_BELLA);

    const { menu, corpo } = await selezionaEApriMenu(page);
    await expect(corpo.locator('strong')).toHaveText('grassetto');
    await expect(corpo.locator('a.filo-md-link')).toHaveAttribute('href', 'https://example.com/guida');
    await expect(corpo).not.toContainText('**');

    const riquadro = await apriRiquadro(page, menu);
    await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });
    await expect(riquadro.locator('strong')).toHaveText('grassetto');
    await expect(riquadro.locator('a.filo-md-link')).toHaveAttribute('href', 'https://example.com/guida');
    await expect(riquadro).not.toContainText('**');

    // Il link si clicca davvero: apre la guida in una scheda nuova.
    const aperture = await page.evaluate(() => {
      window.__aperte853 = [];
      const orig = window.open;
      window.open = (u) => { window.__aperte853.push(u); return null; };
      document.querySelector('.sn-popup .sn-popup-body a.filo-md-link').click();
      window.open = orig;
      return window.__aperte853;
    });
    expect(aperture).toEqual(['https://example.com/guida']);
  });
}

test('#853 Gestione: un tag HTML del modello si legge come testo e non chiede niente fuori', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await apriPagina(openTab, 'filo://manage/manage.html');
  const richieste = [];
  page.on('request', (r) => { if (r.url().includes(OSTILE)) richieste.push(r.url()); });
  await sorvegliaPagina(page);
  await preparaModello(app, RISPOSTA_OSTILE);

  const { menu, corpo } = await selezionaEApriMenu(page);
  await expect(corpo).toContainText('<img id="spia"');
  await expect(corpo).toContainText('<form id="modulo"');

  const riquadro = await apriRiquadro(page, menu);
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });
  await expect(riquadro).toContainText(`<img id="spia" src="https://${OSTILE}/spia.png">`);
  await expect(riquadro).toContainText('</form> fine.');

  expect(await page.evaluate(() => window.__ostili853)).toEqual([]);
  await page.waitForTimeout(300);
  expect(richieste).toEqual([]);
});

test('#853 senza il modulo di formattazione il testo resta testo, anche a metà risposta', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await apriPagina(openTab, 'filo://editor/');
  const richieste = [];
  page.on('request', (r) => { if (r.url().includes(OSTILE)) richieste.push(r.url()); });
  await sorvegliaPagina(page);
  await page.evaluate(() => { window.SN_MARKDOWN = undefined; });
  await preparaModello(app, RISPOSTA_OSTILE);

  const { menu, corpo } = await selezionaEApriMenu(page);
  await expect(corpo).toContainText('<img id="spia"');

  const riquadro = await apriRiquadro(page, menu);
  // A metà: il primo pezzo è arrivato, la risposta non è finita.
  await expect(riquadro).toContainText('<img id="spia"', { timeout: 15_000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).not.toContainText('€');
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });
  await expect(riquadro).toContainText('</form> fine.');

  expect(await page.evaluate(() => window.__ostili853)).toEqual([]);
  expect(richieste).toEqual([]);
});
