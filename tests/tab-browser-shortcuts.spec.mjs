// #404 — Scorciatoie "da browser" Ctrl/Cmd+T/W/L/R MENTRE si naviga un sito. #1476 — Ctrl/Cmd+Shift+T riapre
// l'ultima scheda chiusa (pila della sessione, poi archivio); Ctrl+L porta il cursore nel campo della home, e sulla
// home non la ricarica (si perderebbe quello che c'è scritto).
//
// Bug: queste scorciatoie erano gestite SOLO nel keydown della shell
// (src/renderer/shell.js), che non riceve eventi quando il focus è dentro una
// pagina (WebContentsView). Risultato: dalla pagina (il caso più comune) non
// facevano nulla. Il fix aggiunge Ctrl/Cmd+T/W/L/R al before-input-event
// per-pagina nel main (come già fatto per Alt+cifra), così valgono ovunque.
//
// Ogni test ASSERISCE il successo dell'azione (nuova tab creata, tab chiusa,
// navigazione alla home, reload) iniettando l'evento sulla webContents della
// tab attiva — lo stesso cammino del tasto reale, deterministico in headless.
// Senza il fix ognuno di questi assert è ROSSO: la scorciatoia non ha effetto.

import { test, expect } from './fixtures/electron.mjs';
import { paginaDellaScheda } from './helpers/schede.mjs';

function tabsInfo(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs;
    const active = t.tabs.find((x) => x.id === t.activeId) || null;
    return { ids: t.tabs.map((x) => x.id), count: t.tabs.length, activeId: t.activeId, activeUrl: active ? active.url : null };
  });
}

// Inietta una combinazione Ctrl+<lettera> sulla webContents della tab ATTIVA
// (dove il focus starebbe navigando la pagina), esercitando il before-input-event.
function pressCtrlKey(app, keyCode) {
  return app.evaluate(({ BrowserWindow }, kc) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: kc, modifiers: ['control'] });
  }, keyCode);
}

test('Ctrl+T da una pagina web apre una nuova scheda', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html('<title>SITO</title><h1 id="ok">x</h1>'));
  await page.waitForSelector('#ok');
  const before = await tabsInfo(app);

  await pressCtrlKey(app, 'T');

  await expect.poll(() => tabsInfo(app).then((i) => i.count), { timeout: 10_000 })
    .toBe(before.count + 1);
  // La nuova scheda è la home di Filo ed è attiva.
  const after = await tabsInfo(app);
  expect(after.activeUrl).toContain('filo://newtab/');
});

test('Ctrl+W da una pagina web chiude la scheda corrente', async ({ app, openTab, testServer }) => {
  await openTab(testServer.html('<title>UNO</title><h1 id="ok">1</h1>'));
  const page2 = await openTab(testServer.html('<title>DUE</title><h1 id="ok">2</h1>'));
  await page2.waitForSelector('#ok');
  const before = await tabsInfo(app);
  const closingId = before.activeId;
  expect(before.count).toBeGreaterThanOrEqual(2);

  await pressCtrlKey(app, 'W');

  await expect.poll(() => tabsInfo(app).then((i) => i.ids.includes(closingId)), { timeout: 10_000 })
    .toBe(false);
  const after = await tabsInfo(app);
  expect(after.count).toBe(before.count - 1);
});

test('Ctrl+L da una pagina web apre la home (dove si digita l\'indirizzo)', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html('<title>SITO</title><h1 id="ok">x</h1>'));
  await page.waitForSelector('#ok');
  const before = await tabsInfo(app);
  expect(before.activeUrl).not.toContain('filo://newtab/');
  const sameTab = before.activeId;

  await pressCtrlKey(app, 'L');

  // Stessa scheda, ora sulla home di Filo (il punto dove si scrive un indirizzo).
  await expect.poll(() => tabsInfo(app).then((i) => i.activeUrl), { timeout: 10_000 })
    .toContain('filo://newtab/');
  const after = await tabsInfo(app);
  expect(after.activeId).toBe(sameTab);
});

test('Ctrl+R da una pagina web ricarica la scheda', async ({ app, openTab, testServer }) => {
  // La pagina conta i caricamenti in un contatore in sessionStorage e lo mostra:
  // dopo un reload il valore visibile passa da 1 a 2. Senza reload resta 1.
  const html = `<title>RIC</title><script>
    const n = (Number(sessionStorage.getItem('loads')) || 0) + 1;
    sessionStorage.setItem('loads', String(n));
    addEventListener('DOMContentLoaded', () => { document.body.innerHTML = '<h1 id="loads">' + n + '</h1>'; });
  </script>`;
  const page = await openTab(testServer.html(html));
  await expect(page.locator('#loads')).toHaveText('1');

  await pressCtrlKey(app, 'R');

  // Dopo il reload la stessa Page si ricarica: il contatore diventa 2.
  await expect(page.locator('#loads')).toHaveText('2', { timeout: 10_000 });
});

// ── #1476: riaprire l'ultima scheda chiusa ──────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function info(app, incognito = false) {
  return app.evaluate(({ BrowserWindow }, incognito) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === incognito);
    const t = w._filoTabs;
    const attiva = t.tabs.find((x) => x.id === t.activeId) || null;
    return { urls: t.tabs.map((x) => x.url), count: t.tabs.length, activeId: t.activeId, activeUrl: attiva ? attiva.url : null };
  }, incognito);
}

// Il tasto vero passa da qui: before-input-event della scheda attiva, anche con un campo della pagina a fuoco.
function premi(app, keyCode, modifiers, incognito = false) {
  return app.evaluate(({ BrowserWindow }, { keyCode, modifiers, incognito }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === incognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  }, { keyCode, modifiers, incognito });
}

const chiudi = (app) => premi(app, 'W', ['control']);
const riapri = (app, incognito) => premi(app, 'T', ['control', 'shift'], incognito);

function apriEAspetta(app, url, incognito = false) {
  return app.evaluate(async ({ BrowserWindow }, { url, incognito }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === incognito);
    const tm = w._filoTabs;
    const id = tm.openTab(url);
    const t0 = Date.now();
    while (Date.now() - t0 < 10_000) {
      const tab = tm.tabs.find((t) => t.id === id);
      if (tab && tab.url === url && !tab.loading) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return id;
  }, { url, incognito });
}

test('Ctrl+Shift+T da una pagina riapre la scheda chiusa nel suo posto, con Indietro', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<title>A</title><h1 id="ok">A</h1>');
  const b1 = testServer.html('<title>B1</title><h1 id="ok">B1</h1>');
  const b2 = testServer.html('<title>B2</title><h1 id="ok">B2</h1>');
  const c = testServer.html('<title>C</title><h1 id="ok">C</h1>');
  await openTab(a);
  const pb = await openTab(b1);
  await pb.evaluate((u) => { location.href = u; }, b2);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(b2);
  await openTab(c);
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((t) => t.url === u).id);
  }, b2);
  const prima = await info(app);
  const posto = prima.urls.indexOf(b2);
  expect(posto).toBeGreaterThan(0);
  expect(posto).toBeLessThan(prima.count - 1);

  await chiudi(app);
  await expect.poll(() => info(app).then((i) => i.urls.includes(b2)), { timeout: 10_000 }).toBe(false);

  await riapri(app);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(b2);
  const dopo = await info(app);
  expect(dopo.count).toBe(prima.count);
  expect(dopo.urls.indexOf(b2)).toBe(posto);
  let pagina = null;
  await expect.poll(async () => Boolean(pagina = await paginaDellaScheda(app, dopo.activeId)), { timeout: 10_000 }).toBe(true);
  await expect(pagina.locator('#ok')).toHaveText('B2');

  // La cronologia è tornata con lei: Indietro porta alla pagina di prima.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    tm.goBack(tm.activeId);
  });
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(b1);
});

test('ripetuto va a ritroso, pagine di Filo comprese, poi scende nell\'archivio e alla fine lo dice', async ({ app, shell, avvisi, testServer }) => {
  // Due schede chiuse in una sessione di Filo precedente: stanno solo nell'archivio.
  const vecchia = testServer.html('<title>Vecchia</title><h1>v</h1>');
  const vecchissima = testServer.html('<title>Vecchissima</title><h1>vv</h1>');
  await app.evaluate(async (_e, { vecchia, vecchissima }) => {
    await globalThis.SN_ARCHIVED_TABS.archive({ url: vecchissima, title: 'Vecchissima', closedAt: '2026-10-01T10:00:00.000Z' });
    await globalThis.SN_ARCHIVED_TABS.archive({ url: vecchia, title: 'Vecchia', closedAt: '2026-10-02T10:00:00.000Z' });
  }, { vecchia, vecchissima });

  const sito = testServer.html('<title>Sito</title><h1>s</h1>');
  const interna = 'filo://history/history.html';
  await apriEAspetta(app, sito);
  await chiudi(app);
  await apriEAspetta(app, interna);
  await chiudi(app);
  await expect.poll(() => info(app).then((i) => i.urls.some((u) => u === sito || u.startsWith('filo://history'))), { timeout: 10_000 }).toBe(false);
  const base = (await info(app)).count;

  await riapri(app);
  await expect.poll(() => info(app).then((i) => String(i.activeUrl)), { timeout: 10_000 }).toContain('filo://history/');
  // Dalla pagina di Filo appena riaperta il tasto vale lo stesso.
  await riapri(app);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(sito);
  // Finita la sessione, l'archivio: prima la più recente. Dalla barra a fuoco, stavolta.
  await shell.keyboard.press('Control+Shift+T');
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(vecchia);
  await riapri(app);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(vecchissima);
  expect((await info(app)).count).toBe(base + 4);

  // Niente più da riaprire: nessuna scheda nuova, e un avviso lo dice.
  await riapri(app);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Nessuna scheda chiusa da riaprire' })).toHaveCount(1, { timeout: 10_000 });
  await sleep(500);
  expect((await info(app)).count).toBe(base + 4);
});

test('una scheda cancellata dall\'archivio non torna con Ctrl+Shift+T', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const via = testServer.html('<title>Da dimenticare</title><h1>x</h1>');
  const resta = testServer.html('<title>Resta</title><h1>r</h1>');
  await apriEAspetta(app, resta);
  await chiudi(app);
  await apriEAspetta(app, via);
  await chiudi(app);
  await expect.poll(() => app.evaluate(async (_e, u) =>
    (await globalThis.SN_ARCHIVED_TABS.list()).some((t) => t.url === u), via), { timeout: 8_000 }).toBe(true);
  await app.evaluate(async (_e, u) => {
    const ids = (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => t.url === u).map((t) => t.id);
    await globalThis.SN_ARCHIVED_TABS.removeMany(ids);
  }, via);

  await riapri(app);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(resta);
  expect((await info(app)).urls).not.toContain(via);
});

test('in incognito riapre le schede chiuse in quella finestra, senza archivio', async ({ app, shell, testServer }) => {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
  const privata = testServer.html('<title>Privata</title><h1>p</h1>');
  await apriEAspetta(app, privata, true);
  await premi(app, 'W', ['control'], true);
  await expect.poll(() => info(app, true).then((i) => i.urls.includes(privata)), { timeout: 10_000 }).toBe(false);

  await riapri(app, true);
  await expect.poll(() => info(app, true).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(privata);
  // La finestra normale non la vede.
  expect((await info(app)).urls).not.toContain(privata);
});

test('Ctrl+L da una pagina porta alla home col cursore nel campo dove si scrive', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html('<title>SITO</title><input id="campo"><script>document.getElementById("campo").focus()</script>'));
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('campo');
  const { activeId } = await info(app);

  await premi(app, 'L', ['control']);
  await expect.poll(() => info(app).then((i) => String(i.activeUrl)), { timeout: 10_000 }).toContain('filo://newtab/');
  let home = null;
  await expect.poll(async () => Boolean(home = await paginaDellaScheda(app, activeId, (p) => p.url().startsWith('filo://newtab/'))), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => home.evaluate(() => document.activeElement && document.activeElement.id), { timeout: 10_000 }).toBe('input');

  // Quello che si scrive subito dopo finisce lì.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    for (const ch of 'esempio.it') wc.sendInputEvent({ type: 'char', keyCode: ch });
  });
  await expect(home.locator('#input')).toHaveValue('esempio.it');
});

test('Ctrl+L con del testo scritto nella pagina apre la home accanto e la pagina tiene il testo', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<title>Modulo</title><textarea id="t"></textarea>');
  const page = await openTab(url);
  await page.locator('#t').fill('una lettera lunga scritta a mano');
  const prima = await info(app);
  // Il segnale del testo scritto arriva dalla pagina: si aspetta che sia arrivato, come quando l'utente scrive e poi preme.
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return !!tm.tabs.find((t) => t.id === tm.activeId).formDirty;
  }), { timeout: 10_000 }).toBe(true);

  await premi(app, 'L', ['control']);

  await expect.poll(() => info(app).then((i) => i.count), { timeout: 10_000 }).toBe(prima.count + 1);
  const dopo = await info(app);
  expect(String(dopo.activeUrl)).toContain('filo://newtab/');
  let home = null;
  await expect.poll(async () => Boolean(home = await paginaDellaScheda(app, dopo.activeId, (p) => p.url().startsWith('filo://newtab/'))), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => home.evaluate(() => document.activeElement && document.activeElement.id), { timeout: 10_000 }).toBe('input');
  expect(dopo.urls).toContain(url);
  await expect(page.locator('#t')).toHaveValue('una lettera lunga scritta a mano');
});

test('Ctrl+L sulla home non la ricarica: dà il fuoco al campo e tiene quello che c\'era scritto', async ({ app, shell }) => {
  await shell.waitForLoadState('domcontentloaded');
  let id = null;
  await expect.poll(async () => (id = await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    const a = t.tabs.find((x) => x.id === t.activeId);
    return a && String(a.url).startsWith('filo://newtab/') && !a.loading ? a.id : null;
  })), { timeout: 15_000 }).not.toBe(null);
  let home = null;
  await expect.poll(async () => Boolean(home = await paginaDellaScheda(app, id, (p) => p.url().startsWith('filo://newtab/'))), { timeout: 10_000 }).toBe(true);
  await home.locator('#input').fill('bozza da tenere');
  // Un segno che una ricarica cancellerebbe, e il fuoco portato via dal campo.
  await home.evaluate(() => { window.__nonRicaricata = true; document.activeElement.blur(); });

  for (const premiDa of ['pagina', 'barra']) {
    await home.evaluate(() => { document.activeElement.blur(); window.getSelection().removeAllRanges(); });
    if (premiDa === 'pagina') await premi(app, 'L', ['control']);
    else await shell.keyboard.press('Control+l');
    await expect.poll(() => home.evaluate(() => {
      const i = document.getElementById('input');
      return document.activeElement === i && i.selectionStart === 0 && i.selectionEnd === i.value.length;
    }), { timeout: 10_000, message: premiDa }).toBe(true);
    expect(await home.evaluate(() => [window.__nonRicaricata === true, document.getElementById('input').value])).toEqual([true, 'bozza da tenere']);
  }
});
