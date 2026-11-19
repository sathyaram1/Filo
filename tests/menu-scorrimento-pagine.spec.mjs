// #2586 — i menu propri delle pagine di Filo seguono la regola del tasto destro (#2452): lo scorrimento finito
// nell'istante dell'apertura non chiude il menu appena aperto, uno scorrimento dopo l'apertura sì.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { aggiungiStrumento, strumento } from './helpers/strumentiEditor.mjs';
import { modelloFinto, home, chiedi } from './helpers/chatFinta.mjs';

// La pagina scorre nello stesso compito del gesto che apre il menu: il suo evento «scroll» arriva al fotogramma dopo,
// quando il menu ascolta già. Scorre il contenitore che porta `bersaglio`, o la finestra; in fondo ci va dello spazio.
async function scorriAlGesto(page, gesto, bersaglio) {
  await bersaglio.scrollIntoViewIfNeeded();
  await bersaglio.evaluate((el, gesto) => {
    let chi = el.parentElement;
    while (chi && chi !== document.body && !/(auto|scroll)/.test(getComputedStyle(chi).overflowY)) chi = chi.parentElement;
    if (!chi || chi === document.body) chi = document.scrollingElement;
    chi.dataset.scorreProva = '1';
    const d = document.createElement('div');
    d.style.cssText = 'height:4000px;flex:0 0 4000px';
    (chi === document.scrollingElement ? document.body : chi).appendChild(d);
    chi.dataset.scorreDa = String(chi.scrollTop);
    window.addEventListener(gesto, () => chi.scrollBy({ top: 300, behavior: 'instant' }), { capture: true, once: true });
  }, gesto);
  await fotogrammi(page);
}
const fotogrammi = (page) => page.evaluate(() => new Promise((ok) => {
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 150)));
}));
const scorsa = (page) => page.evaluate(() => {
  const chi = document.querySelector('[data-scorre-prova]');
  return chi.scrollTop - Number(chi.dataset.scorreDa);
});
const scorriAncora = (page) => page.evaluate(() => {
  document.querySelector('[data-scorre-prova]').scrollBy({ top: 200, behavior: 'instant' });
});

// Il menu resta dopo lo scorrimento dell'apertura, e se ne va a quello dopo.
async function restaPoiSiChiude(page, menu) {
  await fotogrammi(page);
  await expect(menu).toBeVisible();
  expect(await scorsa(page), 'la pagina è scorsa davvero all\'apertura').toBeGreaterThan(100);
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
    await scorriAlGesto(page, 'contextmenu');
    await voce.click({ button: 'right' });
    await restaPoiSiChiude(page, page.locator('.dl-ctxmenu'));
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
  await scorriAlGesto(page, 'contextmenu');
  await scheda.click({ button: 'right' });
  await restaPoiSiChiude(page, page.locator('.home-ctxmenu'));
});

test('Bacheca: il menu di una propria segnalazione', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_SEGNALAZIONI_MIE.registra({ id: 'ok', testo: 'Il tasto Salva non salva', stato: 'inviata', num: '990', creataIl: '2026-10-04T10:00:00Z' });
  });
  const page = await openTab('filo://board/board.html#segnalazioni');
  const titolo = page.locator('#bdMie .bd-mia .bd-mia-titolo').first();
  await expect(titolo).toBeVisible();
  await scorriAlGesto(page, 'contextmenu');
  await titolo.click({ button: 'right' });
  await restaPoiSiChiude(page, page.locator('.bd-mia-menu'));
});

test('Editor: il menu del titolo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docSwitch');
  await scorriAlGesto(page, 'contextmenu');
  await page.click('#docSwitch', { button: 'right' });
  await restaPoiSiChiude(page, page.locator('.ed-title-ctxmenu'));
});

test('Editor: la tendina dei font resta anche quando si scorre il suo elenco', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await aggiungiStrumento(page, 'font');
  const mod = strumento(page, 'font');
  const pop = mod.locator('.ed-font-pop');
  await scorriAlGesto(page, 'click');
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

test('Gestione: il menu dell\'ordine', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => {
    window.__mgTest.setData([{ _id: 'A', seq: 10, subSeq: 0, priority: 1, name: 'Uno', clientId: 'owner:me', senderProof: 'admin', createdAt: '2026-06-20T10:00:00Z' }]);
    window.__mgTest.setTab('inbox');
  });
  await expect(page.locator('.mg-item')).toHaveCount(1);
  const lista = '#mgList';
  await page.evaluate((s) => {
    const l = document.querySelector(s);
    const d = document.createElement('div');
    d.style.height = '4000px';
    l.appendChild(d);
  }, lista);
  await scorriAlGesto(page, 'contextmenu', { scorre: lista });
  await page.locator('#mgListHeadRow').click({ button: 'right' });
  await restaPoiSiChiude(page, page.locator('.mg-ctxmenu'), lista);
});

test('Home: il riquadro di una voce del sistema', async ({ app }) => {
  await app.evaluate(async () => {
    globalThis.__sistemaFinto = { batteria: { livello: 42, inCarica: false, collegata: false }, rete: { online: true, tipo: 'wifi', nome: 'Casa' }, bluetooth: { acceso: true, dispositivi: ['Cuffie'] } };
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sistemaFinto);
  });
  const page = await home(app);
  const voce = page.locator('#sistema .dash-sis-voce[data-voce="bluetooth"]');
  await expect(voce).toBeVisible({ timeout: 8_000 });
  await scorriAlGesto(page, 'contextmenu');
  await voce.click({ button: 'right' });
  await restaPoiSiChiude(page, page.locator('.dash-sis-box'));
});

test('Home: il menu di una parola spiegata', async ({ app }) => {
  await modelloFinto(app, [{ text: 'Risponde subito se la risposta sta nella {{cache|Una copia vicina dei dati.}}.' }]);
  const page = await home(app);
  await chiedi(page, 'come fa il browser a trovare un sito?');
  const parola = page.locator('.dash-bubble-md .filo-spiega', { hasText: 'cache' }).last();
  await expect(parola).toBeVisible();
  await scorriAlGesto(page, 'contextmenu');
  await parola.click({ button: 'right' });
  await restaPoiSiChiude(page, page.locator('.filo-spiega-menu'));
});
