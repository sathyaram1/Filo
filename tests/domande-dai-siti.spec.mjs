// #589.1 — cosa ottiene un sito che parla col main dal mondo del preload (isolamento dei contesti
// rotto): solo le domande e i canali del codice di Filo dentro le pagine (impostazioniPerOrigine.js).
// Senza il fix è ROSSO: memoria, pagine salvate, stato, foto della scheda in vista, chiusura di altre schede.

import { test, expect } from './fixtures/electron.mjs';

const MEMORIA = 'Anna, vive a MILANO-5891, lavora in ospedale';
const SALVATA = 'CONTO-CORRENTE-5891';

// Il codice gira nel mondo isolato del preload della pagina riconosciuta da `quale`: lì
// vivono i content script e lo shim chrome.*, come per un sito che ne ha rotto il confine.
function dalPreload(app, quale) {
  return (codice) => app.evaluate(async ({ BrowserWindow }, { src, codice: c }) => {
    // eslint-disable-next-line no-new-func
    const scegli = new Function('u', `return (${src})(u);`);
    const wcs = BrowserWindow.getAllWindows().flatMap((w) => [
      ...(w._filoTabs?.tabs || []).map((t) => t.view.webContents),
      ...(w._filoTabs ? [] : [w.webContents]),
    ]);
    const wc = wcs.find((x) => { try { return scegli(x.getURL()); } catch (_) { return false; } });
    if (!wc) return { nonTrovata: true };
    try {
      return { risposta: await wc.executeJavaScriptInIsolatedWorld(999, [{ code: c }]) };
    } catch (e) { return { errore: String(e) }; }
  }, { src: quale.toString(), codice });
}

const chiedi = (tipo, extra = {}) => `chrome.runtime.sendMessage(${JSON.stringify({ type: tipo, ...extra })})`;

async function datiPersonali(shell) {
  await shell.evaluate(async ({ memoria, salvata }) => {
    const m = (x) => window.filoShell.message(x);
    await m({ type: '_storage:set', obj: { filo_memory: { PROFILO: memoria } } });
    await m({ type: 'save_page', page: { url: 'https://banca.example/conto', title: salvata, text: 'saldo' } });
  }, { memoria: MEMORIA, salvata: SALVATA });
}

async function schede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return { attiva: w._filoTabs.activeId, tutte: w._filoTabs.tabs.map((t) => ({ id: t.id, url: String(t.url || '') })) };
  });
}

test('un sito non si fa dare memoria, pagine salvate, stato, archivio e categorie; le sue domande rispondono', async ({ app, shell, openTab, testServer }) => {
  await datiPersonali(shell);
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const sito = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));

  const domande = ['filo_get_memory', 'get_saved_pages', 'filo_get_state', 'get_archived_tabs', 'get_categories', 'get_credits', 'auth_signout'];
  for (const tipo of domande) {
    const r = await sito(chiedi(tipo));
    expect(r.nonTrovata || r.errore, `${tipo}: il preload del sito non è stato raggiunto`).toBeFalsy();
    expect(r.risposta, `${tipo}: un sito ha avuto risposta a una domanda che il codice dentro le pagine non fa`).toMatchObject({ ok: false, code: 'forbidden' });
    const testo = JSON.stringify(r.risposta);
    expect(testo).not.toContain('MILANO-5891');
    expect(testo).not.toContain(SALVATA);
  }

  // Le domande del codice di Filo dentro la pagina restano: impostazioni (ritagliate) e navigazione.
  const impostazioni = await sito(chiedi('get_settings'));
  expect(impostazioni.risposta?.ok).toBe(true);
  expect(impostazioni.risposta?.settings?.theme).toBeTruthy();
  const nav = await sito(chiedi('nav_state'));
  expect(nav.risposta?.ok).toBe(true);

  // Dalla cornice di Filo gli stessi dati ci sono: il rifiuto è per provenienza, non per assenza.
  const daFilo = await shell.evaluate(async () => ({
    memoria: await window.filoShell.message({ type: 'filo_get_memory' }),
    salvate: await window.filoShell.message({ type: 'get_saved_pages' }),
  }));
  expect(JSON.stringify(daFilo.memoria)).toContain('MILANO-5891');
  expect(JSON.stringify(daFilo.salvate)).toContain(SALVATA);
  void web;
});

test('la foto la chiede solo la scheda in vista, e inquadra sé stessa', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<style>html,body{background:#0000ff;height:100%;margin:0}</style><h1>sfondo</h1>');
  await testServer.openReady(openTab, '<style>html,body{background:#ff0000;height:100%;margin:0}</style><h1>in vista</h1>', { pubblico: true });
  const sfondo = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));
  const inVista = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  await expect.poll(async () => {
    const { attiva, tutte } = await schede(app);
    return tutte.find((t) => t.id === attiva)?.url || '';
  }).toMatch(/^http:\/\/sito-pubblico\.test/);

  for (const tipo of ['capture_visible_tab', 'capture_feedback_topbar']) {
    const r = await sfondo(chiedi(tipo));
    expect(r.nonTrovata || r.errore).toBeFalsy();
    expect(r.risposta, `${tipo}: una scheda di sfondo ha avuto la foto`).toMatchObject({ ok: false, code: 'forbidden' });
    expect(r.risposta?.dataUrl).toBeFalsy();
  }

  // La scheda in vista la ottiene (salva per dopo, feedback, barra d'aiuto), ed è la sua pagina.
  let scatto = null;
  await expect.poll(async () => {
    scatto = await inVista(chiedi('capture_visible_tab'));
    return (scatto.risposta?.dataUrl || '').length;
  }, { timeout: 15000 }).toBeGreaterThan(1000);
  const colore = await app.evaluate(({ nativeImage }, u) => {
    const img = nativeImage.createFromDataURL(u);
    const { width, height } = img.getSize();
    const bmp = img.toBitmap();
    const i = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4;
    return { r: bmp[i + 2], g: bmp[i + 1], b: bmp[i] };
  }, scatto.risposta.dataUrl);
  expect(colore.r > 200 && colore.b < 60, `la foto non è della scheda in vista: ${JSON.stringify(colore)}`).toBe(true);
});

test('un sito non chiude le altre schede, né per messaggio né dal canale delle schede', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>sito</h1>');
  await testServer.openReady(openTab, '<h1>altra scheda</h1>', { pubblico: true });
  const { tutte } = await schede(app);
  const altra = tutte.find((t) => t.url.startsWith('http://sito-pubblico.test'));
  const sitoId = tutte.find((t) => t.url.startsWith('http://127.0.0.1')).id;
  expect(altra).toBeTruthy();
  const sito = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));

  const perMessaggio = await sito(chiedi('_tabs:remove', { id: altra.id }));
  expect(perMessaggio.risposta).toMatchObject({ ok: false, code: 'forbidden' });

  // I canali delle schede li usa la cornice: bussiamo come farebbe il sito, col suo mittente.
  const dalCanale = await app.evaluate(async ({ BrowserWindow, ipcMain }, { id, daChi }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const wc = w._filoTabs.tabs.find((t) => t.id === daChi).view.webContents;
    const esiti = {};
    for (const [canale, args] of [['tabs:close', { id }], ['tabs:navigate', { id, url: 'https://altrove.example/' }], ['tabs:snapshot', undefined]]) {
      const h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get(canale);
      if (!h) { esiti[canale] = 'handler introvabile'; continue; }
      try { esiti[canale] = await h({ sender: wc, senderFrame: wc.mainFrame }, args); } catch (e) { esiti[canale] = { eccezione: String(e) }; }
    }
    return esiti;
  }, { id: altra.id, daChi: sitoId });
  for (const [canale, esito] of Object.entries(dalCanale)) {
    expect(esito, `${canale}: un sito ha usato un canale della cornice`).toMatchObject({ ok: false, code: 'forbidden' });
  }
  await new Promise((r) => setTimeout(r, 500));
  expect((await schede(app)).tutte.find((t) => t.id === altra.id)?.url, 'la scheda dell\'utente è stata chiusa o spostata da un sito').toBe(altra.url);

  // La cornice la chiude.
  await shell.evaluate((id) => window.filoShell.tabs.close(id), altra.id);
  await expect.poll(async () => (await schede(app)).tutte.some((t) => t.id === altra.id)).toBe(false);
});

test('la finestra di accesso aperta da un sito vale come sito, non come la cornice', async ({ app, shell, openTab, testServer }) => {
  await datiPersonali(shell);
  const accesso = testServer.html('<h1>accedi</h1>');
  const web = await testServer.openReady(openTab, `<button id="apri" onclick="window.open('${accesso}?client_id=a&redirect_uri=b', 'accesso', 'width=400,height=400')">accedi</button>`);
  await web.click('#apri');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .some((w) => !w._filoTabs && String(w.webContents.getURL()).includes('client_id=a'))), { timeout: 10000 }).toBe(true);
  const finestra = dalPreload(app, (u) => u.includes('client_id=a'));
  await expect.poll(async () => (await finestra('typeof chrome')).risposta, { timeout: 10000 }).toBe('object');

  for (const tipo of ['filo_get_memory', 'get_saved_pages', 'auth_signout', 'capture_visible_tab']) {
    const r = await finestra(chiedi(tipo));
    expect(r.risposta, `${tipo}: la finestra aperta dal sito è stata trattata come la cornice di Filo`).toMatchObject({ ok: false, code: 'forbidden' });
    expect(JSON.stringify(r.risposta)).not.toContain('MILANO-5891');
  }
});

// Giro 1 di verifica: una domanda ammessa non arriva oltre la scheda che la fa.
test('una scheda di sfondo non cambia ciò che l\'utente guarda; quella in vista apre ancora le sue schede', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>sfondo</h1>');
  const inVista = await testServer.openReady(openTab, '<h1>posta</h1><textarea id="bozza"></textarea>', { pubblico: true });
  await inVista.fill('#bozza', 'bozza che l\'utente sta scrivendo');
  const sfondo = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));
  const prima = await schede(app);
  const guardata = prima.tutte.find((t) => t.id === prima.attiva);
  expect(guardata.url).toMatch(/^http:\/\/sito-pubblico\.test/);

  for (const [tipo, extra] of [
    ['shell_action', { command: 'home' }], ['toggle_fullscreen', {}], ['open_url', { url: `${testServer.origin}/non-cercata` }],
    ['open_options', {}], ['open_new_tab', {}], ['filo_run_action', { action: { type: 'NAVIGA', url: `${testServer.origin}/navigata` } }],
    ['feedback_annotate', { on: true }],
  ]) {
    const r = await sfondo(chiedi(tipo, extra));
    expect(r.nonTrovata || r.errore).toBeFalsy();
    expect(r.risposta, `${tipo}: una scheda di sfondo ha agito su ciò che l'utente guarda`).toMatchObject({ ok: false, code: 'forbidden' });
  }
  await new Promise((r) => setTimeout(r, 800));
  const dopo = await schede(app);
  expect(dopo.attiva).toBe(guardata.id);
  expect(dopo.tutte.find((t) => t.id === guardata.id)?.url).toBe(guardata.url);
  expect(dopo.tutte).toHaveLength(prima.tutte.length);
  expect(await app.evaluate(({ BrowserWindow }) => Boolean(BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.contentFullscreen))).toBe(false);
  await expect(inVista.locator('#bozza')).toHaveValue('bozza che l\'utente sta scrivendo');

  // La scheda in vista apre ancora il link dal menu, anche da un suo riquadro.
  const vista = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  expect((await vista(chiedi('open_url', { url: `${testServer.origin}/voluta` }))).risposta?.ok).toBe(true);
  await expect.poll(async () => (await schede(app)).tutte.some((t) => t.url.endsWith('/voluta'))).toBe(true);
});

test('il premio del feedback dice a un sito la cifra, non il saldo', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>sito</h1>');
  const sito = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));
  const r = await sito(chiedi('credits_award_feedback'));
  expect(r.risposta?.ok).toBe(true);
  expect(r.risposta?.credits).toBeGreaterThan(0);
  expect(Object.prototype.hasOwnProperty.call(r.risposta, 'balance'), JSON.stringify(r.risposta)).toBe(false);
  const saldo = await shell.evaluate(async () => (await window.filoShell.message({ type: 'get_credits' }))?.credits?.balance);
  expect(typeof saldo).toBe('number');
  expect(JSON.stringify(r.risposta)).not.toContain(String(saldo));
});

test('la foto della barra un sito la riceve solo mentre l\'utente ci ha disegnato sopra', async ({ app, shell, openTab, testServer }) => {
  const altra = await testServer.openReady(openTab, '<title>AAAAAAAAAAAAAAAAAAAAAAAA</title><h1>altra</h1>');
  await testServer.openReady(openTab, '<title>sito</title><h1>in vista</h1>', { pubblico: true });
  const sito = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  await expect.poll(async () => {
    const { attiva, tutte } = await schede(app);
    return tutte.find((t) => t.id === attiva)?.url || '';
  }).toMatch(/^http:\/\/sito-pubblico\.test/);

  const senza = await sito(chiedi('capture_feedback_topbar'));
  expect(senza.risposta, 'senza un disegno dell\'utente il sito ha avuto la foto della barra coi titoli delle altre schede').toMatchObject({ ok: false, code: 'forbidden' });
  await altra.evaluate(() => { document.title = 'WWWWWWWWWWWWWWWWWWWWWWWW'; });

  // Il riquadro del feedback aperto e un tratto dell'utente sulla barra: la foto arriva.
  await sito('SN_FEEDBACK_UI.open()');
  await expect(shell.locator('#feedback-draw')).toBeVisible({ timeout: 4000 });
  const box = await shell.locator('#feedback-draw').boundingBox();
  const y = Math.min(15, (box?.height || 40) / 2);
  await shell.mouse.move(160, y);
  await shell.mouse.down();
  await shell.mouse.move(280, y + 2, { steps: 6 });
  await shell.mouse.up();
  let foto = null;
  await expect.poll(async () => {
    foto = await sito(chiedi('capture_feedback_topbar'));
    return (foto.risposta?.dataUrl || '').length;
  }, { timeout: 5000 }).toBeGreaterThan(500);

  // Chiuso il riquadro il disegno se ne va, e con lui la foto.
  await sito('SN_FEEDBACK_UI.close()');
  await expect(shell.locator('#feedback-draw')).toBeHidden({ timeout: 4000 });
  await expect.poll(async () => (await sito(chiedi('capture_feedback_topbar'))).risposta?.code).toBe('forbidden');
});

// Giro 2 di verifica: le domande che il codice di Filo fa solo dopo un gesto dell'utente vogliono il gesto.
test('senza un gesto dell\'utente un sito non legge gli appunti; dopo un clic una volta sola', async ({ app, openTab, testServer }) => {
  const pagina = await testServer.openReady(openTab, '<h1 style="height:60vh">in vista</h1>');
  const sito = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));
  await app.evaluate(({ clipboard, BrowserWindow }) => {
    clipboard.writeText('PASSWORD-5891');
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.focus();
    w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.focus();
  });
  const leggi = () => pagina.evaluate(() => Promise.race([
    navigator.clipboard.readText().catch((e) => `rifiuto ${e.name}`),
    new Promise((r) => setTimeout(() => r('in attesa'), 2000)),
  ]));

  const senza = await sito(chiedi('permesso_filo', { tipo: 'appunti' }));
  expect(senza.nonTrovata || senza.errore).toBeFalsy();
  expect(senza.risposta, 'senza un gesto il sito si è dato il lasciapassare di Incolla').toMatchObject({ ok: false, code: 'forbidden' });
  expect(await leggi(), 'il sito ha letto gli appunti senza un gesto dell\'utente').not.toBe('PASSWORD-5891');

  // Il clic vero dell'utente sulla pagina è quello che Incolla e Detta hanno sempre: la domanda passa, una volta.
  await pagina.click('h1');
  expect((await sito(chiedi('permesso_filo', { tipo: 'appunti' }))).risposta?.ok).toBe(true);
  expect((await sito(chiedi('permesso_filo', { tipo: 'appunti' }))).risposta?.code).toBe('forbidden');
});

test('un sito non legge né spinge fuori le pagine salvate, e non cancella dizionario e menu', async ({ app, shell, openTab, testServer }) => {
  await datiPersonali(shell);
  await shell.evaluate(async () => {
    await window.filoShell.message({ type: '_storage:set', obj: { sn_icon_layout: { primary: ['copy'], secondary: [], mio: true }, sn_personal_dict: ['Sathya'] } });
  });
  const pagina = await testServer.openReady(openTab, '<h1 style="height:60vh">in vista</h1>');
  await testServer.openReady(openTab, '<h1>sfondo</h1>', { pubblico: true });
  await pagina.bringToFront();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => String(x.url).startsWith('http://127.0.0.1'));
    w._filoTabs.activate(t.id);
  });
  const sfondo = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  const vista = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));

  const sonda = await sfondo(chiedi('save_page', { page: { url: 'https://banca.example/conto' } }));
  expect(sonda.nonTrovata || sonda.errore).toBeFalsy();
  expect(sonda.risposta).toMatchObject({ ok: false, code: 'forbidden' });
  const riusciti = await sfondo(`(async () => { let n = 0; for (let i = 0; i < 1000; i++) { const r = await chrome.runtime.sendMessage({ type: 'save_page', page: { url: 'https://spam.example/' + i } }); if (r && r.ok) n++; } return n; })()`);
  expect(riusciti.risposta, 'un sito di sfondo ha salvato pagine senza un gesto dell\'utente').toBe(0);
  const tolti = await sfondo(`chrome.runtime.sendMessage({ type: '_storage:remove', keys: ['sn_icon_layout', 'sn_personal_dict'] })`);
  expect(tolti.risposta).toMatchObject({ ok: false, code: 'forbidden' });

  // Dopo un clic sulla pagina in vista: un salvataggio solo, e la risposta dice dove è finita, non cosa c'era.
  await pagina.click('h1');
  const dopo = await vista(chiedi('save_page', { page: { url: 'https://banca.example/conto' } }));
  expect(dopo.risposta?.ok).toBe(true);
  expect(dopo.risposta?.entry?.id).toBeTruthy();
  expect(JSON.stringify(dopo.risposta), 'la risposta al sito porta il titolo di una pagina salvata dall\'utente').not.toContain(SALVATA);
  expect((await vista(chiedi('save_page', { page: { url: 'https://spam.example/x' } }))).risposta?.code, 'un clic, un salvataggio').toBe('forbidden');

  const resta = await shell.evaluate(async () => ({
    salvate: (await window.filoShell.message({ type: 'get_saved_pages' })).pages.map((p) => p.title),
    magazzino: (await window.filoShell.message({ type: '_storage:get', keys: ['sn_icon_layout', 'sn_personal_dict'] })).value,
  }));
  expect(resta.salvate).toContain(SALVATA);
  expect(resta.magazzino?.sn_icon_layout?.mio).toBe(true);
  expect(resta.magazzino?.sn_personal_dict).toEqual(['Sathya']);
});
