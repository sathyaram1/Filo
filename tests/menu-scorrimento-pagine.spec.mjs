// #2586 — i menu propri delle pagine di Filo seguono la regola del tasto destro (#2452): lo scorrimento finito
// nell'istante dell'apertura non chiude il menu appena aperto, uno scorrimento dopo l'apertura sì. Sentinella:
// tests/unit/menuScorrimentoPrima.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { aggiungiStrumento, strumento } from './helpers/strumentiEditor.mjs';
import { home } from './helpers/chatFinta.mjs';

// Scorre il contenitore che porta `bersaglio` (o la finestra, con `finestra`), allungato da uno spazio in fondo: va
// fuori dall'elenco che la pagina ridisegna.
async function preparaScorrimento(bersaglio, { finestra = false } = {}) {
  const page = bersaglio.page();
  await bersaglio.evaluate((el, finestra) => {
    let chi = finestra ? null : el.parentElement;
    while (chi && chi !== document.body && !/(auto|scroll)/.test(getComputedStyle(chi).overflowY)) chi = chi.parentElement;
    if (!chi || chi === document.body) chi = document.scrollingElement;
    chi.dataset.scorreProva = '1';
    const spazio = document.createElement('div');
    spazio.style.cssText = 'height:4000px;flex:0 0 4000px';
    (chi === document.scrollingElement ? document.body : chi).appendChild(spazio);
  }, finestra);
  await fotogrammi(page);
  await bersaglio.scrollIntoViewIfNeeded();
  await fotogrammi(page);
  await page.evaluate(() => {
    const chi = document.querySelector('[data-scorre-prova]');
    chi.dataset.scorreDa = String(chi.scrollTop);
  });
}
const SCORRI = `window.__scorri = (n) => {
  document.querySelector('[data-scorre-prova]').scrollBy({ top: n, behavior: 'instant' });
}; true`;
// Scorre e apre col tasto destro nello stesso fotogramma, come chi porta la voce sotto il puntatore e preme subito:
// l'evento «scroll» arriva al fotogramma dopo, quando il menu ascolta già.
async function scorriEApri(page, bersaglio, opzioni) {
  await preparaScorrimento(bersaglio, opzioni);
  await page.evaluate(SCORRI);
  await bersaglio.evaluate((el) => new Promise((ok) => {
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(r.width / 2, 40);
    const y = r.top + r.height / 2;
    requestAnimationFrame(() => {
      window.__scorri(300);
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 2 }));
      ok();
    });
  }));
}
// Per chi apre solo a un gesto vero: la pagina scorre nello stesso compito del gesto, prima che il menu nasca.
async function scorriAlGesto(page, gesto, bersaglio, opzioni) {
  await preparaScorrimento(bersaglio, opzioni);
  await page.evaluate(SCORRI);
  await page.evaluate((gesto) => {
    window.addEventListener(gesto, () => window.__scorri(300), { capture: true, once: true });
  }, gesto);
}
const fotogrammi = (page) => page.evaluate(() => new Promise((ok) => {
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 150)));
}));
const attesa = (page, ms) => page.evaluate((t) => new Promise((ok) => setTimeout(ok, t)), ms);
const scorsa = (page) => page.evaluate(() => {
  const chi = document.querySelector('[data-scorre-prova]');
  return chi.scrollTop - Number(chi.dataset.scorreDa);
});
const scorriAncora = (page) => page.evaluate(() => window.__scorri(200));

// Il menu resta dopo lo scorrimento dell'apertura, e se ne va a quello dopo.
async function restaPoiSiChiude(page, menu) {
  await fotogrammi(page);
  await expect(menu).toBeVisible();
  expect(await scorsa(page), 'la pagina è scorsa davvero all\'apertura').toBeGreaterThan(100);
  await attesa(page, 350);
  await expect(menu).toBeVisible();
  await scorriAncora(page);
  await expect(menu).toBeHidden();
}

test('Scaricamenti: il menu di una voce', async ({ app, shell, openTab, testServer }) => {
  const FILE = Buffer.from('%PDF-1.4\n' + 'x'.repeat(2048));
  const srv = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': FILE.length, 'Content-Disposition': 'attachment; filename="scorre.pdf"' });
    res.end(FILE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const sito = await testServer.openReady(openTab, `<!doctype html><body><a id="dl" href="http://127.0.0.1:${srv.address().port}/scorre.pdf">giù</a></body>`);
    await sito.locator('#dl').click();
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      return (((r && r.items) || []).find((it) => it.filename === 'scorre.pdf') || {}).state || null;
    }, { timeout: 15_000 }).toBe('completed');
    const page = await openTab('filo://downloads/downloads.html');
    const voce = page.locator('.dl-item[data-state="completed"]').first();
    await expect(voce).toBeVisible();
    await scorriEApri(page, voce);
    await restaPoiSiChiude(page, menuDi(page).principale);
  } finally {
    srv.close();
  }
});

test('Aperti per dopo: il menu di una scheda', async ({ openTab }) => {
  const page = await openTab('filo://home/home.html');
  await page.evaluate(async () => {
    const ora = new Date().toISOString();
    await chrome.storage.local.set({
      savedPages: [{ id: 'a', url: 'https://example.com/a', title: 'Pagina A', favicon: '', thumbnail: '', savedAt: ora, categoryId: null, category: null }],
      categories: [],
    });
    await window.SN_STORAGE.updateSettings({ featureFlags: { categorize: false } });
  });
  await page.reload();
  const scheda = page.locator('#grid .sn-card[data-page-id="a"]');
  await expect(scheda).toBeVisible();
  await scorriEApri(page, scheda);
  await restaPoiSiChiude(page, menuDi(page).principale);
});

test('Bacheca: il menu di una propria segnalazione', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_SEGNALAZIONI_MIE.registra({ id: 'ok', testo: 'Il tasto Salva non salva', stato: 'inviata', num: '990', creataIl: '2026-10-04T10:00:00Z' });
  });
  const page = await openTab('filo://board/board.html#segnalazioni');
  const titolo = page.locator('#bdMie .bd-mia .bd-mia-titolo').first();
  await expect(titolo).toBeVisible();
  await scorriEApri(page, titolo);
  await restaPoiSiChiude(page, menuDi(page).principale);
});

test('Editor: il menu del titolo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docSwitch');
  await scorriEApri(page, page.locator('#docSwitch'));
  await restaPoiSiChiude(page, menuDi(page).principale);
});

test('Editor: la tendina dei font resta anche quando si scorre il suo elenco', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await aggiungiStrumento(page, 'font');
  const mod = strumento(page, 'font');
  const pop = mod.locator('.ed-font-pop');
  // Al clic il punto del bottone deve restare quello: scorre il documento, non il pannello che lo porta.
  await scorriAlGesto(page, 'click', mod.locator('.ed-font-button'), { finestra: true });
  await mod.locator('.ed-font-button').click();
  await fotogrammi(page);
  await expect(pop).toBeVisible();
  expect(await scorsa(page)).toBeGreaterThan(100);

  await mod.locator('.ed-font-list').evaluate((l) => l.scrollBy({ top: 120, behavior: 'instant' }));
  await fotogrammi(page);
  await expect(pop, 'scorrere fra i font non chiude la tendina').toBeVisible();
  expect(await mod.locator('.ed-font-list').evaluate((l) => l.scrollTop)).toBeGreaterThan(0);

  await scorriAncora(page);
  await expect(pop).toBeHidden();
});

test('Gestione: il menu di una scheda', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => {
    window.__mgTest.setData([{ _id: 'A', seq: 10, subSeq: 0, priority: 1, name: 'Uno', clientId: 'owner:me', senderProof: 'admin', createdAt: '2026-06-20T10:00:00Z' }]);
    window.__mgTest.setTab('inbox');
  });
  await expect(page.locator('.mg-item')).toHaveCount(1);
  const scheda = page.locator('.mg-item').first();
  await scorriEApri(page, scheda);
  await restaPoiSiChiude(page, menuDi(page).principale);
});

test('Home: il riquadro di una voce del sistema', async ({ app }) => {
  await app.evaluate(async () => {
    globalThis.__sistemaFinto = { batteria: { livello: 42, inCarica: false, collegata: false }, rete: { online: true, tipo: 'wifi', nome: 'Casa' }, bluetooth: { acceso: true, dispositivi: ['Cuffie'] } };
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sistemaFinto);
  });
  const page = await home(app);
  const voce = page.locator('#sistema .dash-sis-voce[data-voce="bluetooth"]');
  await expect(voce).toBeVisible({ timeout: 8_000 });
  await scorriEApri(page, voce);
  await restaPoiSiChiude(page, page.locator('.dash-sis-box'));
});

// Le parole spiegate si aprono solo a un tasto destro vero; la pagina delle segnalazioni le attacca al suo documento
// come la home alla chat, e scorre con la finestra.
test('Il menu di una parola spiegata', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => window.SN_MARKDOWN && window.SN_SPIEGAZIONI);
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'prova';
    d.innerHTML = window.SN_MARKDOWN.render('Risponde subito se la risposta sta nella {{cache|Una copia vicina dei dati.}}.');
    document.body.prepend(d);
  });
  const parola = page.locator('#prova .filo-spiega');
  await scorriAlGesto(page, 'contextmenu', parola, { finestra: true });
  await parola.click({ button: 'right' });
  await restaPoiSiChiude(page, page.locator('.filo-spiega-menu'));
});
