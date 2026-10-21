// Riordino/ripristino delle schede alla riapertura di Filo (feedback #266).
//
// Due garanzie che il feedback "le tab non sono chiuse/riordinate come
// dovrebbero" richiede:
//   1) il riordino cromatico della barra avviene a OGNI giro di triage
//      (riapertura compresa), NON solo quando qualcosa viene archiviato;
//   2) la sessione salva e ripristina il colore identità di ogni scheda, così
//      la barra riparte già tinta e il riordino ha i dati subito.

import { createRequire } from 'node:module';
import { test, expect } from './fixtures/electron.mjs';

const mk = (title, color) =>
  `<!doctype html><html><head><title>${title}</title>`
  + `${color ? `<meta name="theme-color" content="${color}">` : ''}</head>`
  + `<body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;

// La regola d'ordine della barra, dal modulo condiviso: l'ordine atteso si calcola dai colori REALI assegnati.
createRequire(import.meta.url)('../src/shared/tabColor.js');
const TC = globalThis.SN_TAB_COLOR;
const tinta = (c) => { const p = TC.parseRgb(c); return p ? TC.rgbToHsl(...p)[0] * 360 : NaN; };

test('alla riapertura le schede vengono riordinate per colore anche senza archiviare nulla', async ({ app, shell, openTab, testServer }) => {
  // Aperte in ordine NON cromatico (blu → verde → rosso): dopo il riordino
  // devono finire per tinta (rosso → verde → blu).
  await testServer.openReady(openTab, mk('Blu', 'rgb(40,80,200)'));
  await testServer.openReady(openTab, mk('Verde', 'rgb(40,200,80)'));
  await testServer.openReady(openTab, mk('Rosso', 'rgb(200,40,40)')); // ultima → attiva

  // Attendi che ognuna abbia il SUO colore dal content script: le tre pagine stanno sullo stesso host, e il
  // colore identità si ricorda per host, quindi appena aperta una scheda porta quello della sorella.
  const dichiarato = { Blu: 'rgb(40,80,200)', Verde: 'rgb(40,200,80)', Rosso: 'rgb(200,40,40)' };
  await expect.poll(async () => {
    const web = await shell.evaluate(async () => {
      const s = await window.filoShell.tabs.snapshot();
      return s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || ''))
        .map((t) => ({ title: t.title, identityColor: t.identityColor }));
    });
    return web.length === 3 && web.every((t) => dichiarato[t.title]
      && Math.abs(tinta(t.identityColor) - tinta(dichiarato[t.title])) < 2);
  }, { timeout: 12_000 }).toBe(true);

  // Ordine di inserimento e ordine cromatico atteso, dai colori REALI assegnati.
  const before = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || ''))
      .map((t) => ({ title: t.title, identityColor: t.identityColor }));
  });
  const insertionOrder = before.map((t) => t.title);
  const expectedOrder = [...before]
    .sort((a, b) => TC.compareRainbow(a.identityColor, b.identityColor))
    .map((t) => t.title);
  // Sanity: lo scenario è non-banale (l'ordine cromatico differisce da quello
  // d'inserimento), altrimenti il test passerebbe anche senza riordino.
  expect(expectedOrder).not.toEqual(insertionOrder);

  // Stub LLM: TIENI tutto → nessuna archiviazione. Prima del fix, con 0 archivi
  // il riordino non partiva affatto.
  const res = await app.evaluate(async ({ BrowserWindow }) => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: 'keep', reason: 'test' })),
    });
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return win._filoTabs.runAutoTriage({ trigger: 'reopen' });
  });
  expect(res.archived).toBe(0);

  // La barra è stata riordinata per colore pur non avendo archiviato nulla.
  const after = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.filter((t) => /127\.0\.0\.1/.test(t.url || '')).map((t) => t.title);
  });
  expect(after).toEqual(expectedOrder);
});

test('la sessione salva e ripristina il colore identità delle schede', async ({ app, shell, openTab, testServer }) => {
  // Save side: una scheda con identità colorata finisce in sessionState con il
  // suo colore, allineato indice-per-indice agli URL.
  await testServer.openReady(openTab, mk('Colorata', 'rgb(200,40,40)'));
  await expect.poll(async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => /127\.0\.0\.1/.test(x.url || ''));
    return !!(t && t.identityColor);
  }), { timeout: 12_000 }).toBe(true);

  const state = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return win._filoTabs.sessionState();
  });
  expect(Array.isArray(state.colors)).toBe(true);
  expect(state.colors.length).toBe(state.tabs.length);
  const webIdx = state.tabs.findIndex((u) => /127\.0\.0\.1/.test(u || ''));
  expect(webIdx).toBeGreaterThanOrEqual(0);
  expect(state.colors[webIdx]).toBeTruthy();

  // Restore side: seminata una sessione con un colore, restoreSession lo applica
  // subito alla scheda ripristinata (letto in-process, prima che i content
  // script ricalcolino). Pagina senza favicon/theme così solo il colore
  // ripristinato può essere presente in quell'istante.
  const url = testServer.html('<!doctype html><html><head><title>Ripristina</title></head><body>plain</body></html>');
  const restored = await app.evaluate(async ({ BrowserWindow }, args) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    const key = tm._sessionKey();
    await globalThis.SN_STORAGE.setRaw(key, { tabs: [args.url], colors: [args.color], activeIndex: 0 });
    await tm.restoreSession();
    const snap = tm.snapshot();
    const t = snap.tabs.find((x) => x.url === args.url);
    return t ? t.identityColor : null;
  }, { url, color: 'rgb(12,34,56)' });
  expect(restored).toBe('rgb(12,34,56)');
});
