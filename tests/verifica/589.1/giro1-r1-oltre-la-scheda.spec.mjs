// #589.1 giro 1, rilievo 1 — le domande che la lista lascia passare non devono arrivare oltre la
// scheda che le fa: comandi della barra e schermo intero da una scheda di sfondo, il saldo dei
// crediti nella risposta del premio, i titoli delle altre schede nella foto della barra.

import { test, expect } from '../../fixtures/electron.mjs';

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

async function schede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return {
      attiva: w._filoTabs.activeId,
      schermoIntero: Boolean(w._filoTabs.contentFullscreen),
      tutte: w._filoTabs.tabs.map((t) => ({ id: t.id, url: String(t.url || '') })),
    };
  });
}

test('una scheda di sfondo non preme i tasti della barra né manda a schermo intero la scheda che l\'utente guarda', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>sfondo</h1>');
  const inVista = await testServer.openReady(openTab, '<h1>posta</h1><textarea id="bozza"></textarea>', { pubblico: true });
  await inVista.fill('#bozza', 'bozza lunga che l\'utente sta scrivendo');
  const sfondo = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));
  const prima = await schede(app);
  const guardata = prima.tutte.find((t) => t.id === prima.attiva);
  expect(guardata.url).toMatch(/^http:\/\/sito-pubblico\.test/);

  const home = await sfondo(chiedi('shell_action', { command: 'home' }));
  expect(home.nonTrovata || home.errore).toBeFalsy();
  const schermo = await sfondo(chiedi('toggle_fullscreen'));
  await new Promise((r) => setTimeout(r, 1500));

  const dopo = await schede(app);
  expect(dopo.tutte.find((t) => t.id === guardata.id)?.url, 'una scheda di sfondo ha portato via la pagina che l\'utente stava guardando').toBe(guardata.url);
  expect(dopo.schermoIntero, 'una scheda di sfondo ha messo a schermo intero la scheda che l\'utente guarda').toBe(false);
  void schermo;
});

test('la risposta al premio del feedback non dice a un sito il saldo dei crediti', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>sito</h1>');
  const sito = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));
  const r = await sito(chiedi('credits_award_feedback'));
  expect(r.nonTrovata || r.errore).toBeFalsy();
  const saldo = await shell.evaluate(async () => (await window.filoShell.message({ type: 'get_credits' }))?.credits?.balance);
  expect(typeof saldo).toBe('number');
  expect(r.risposta && Object.prototype.hasOwnProperty.call(r.risposta, 'balance'), `il sito ha letto il saldo: ${JSON.stringify(r.risposta)}`).toBe(false);
  expect(JSON.stringify(r.risposta || {})).not.toContain(String(saldo));
});

test('la foto della barra chiesta da un sito non cambia coi titoli delle altre schede', async ({ app, openTab, testServer }) => {
  const altra = await testServer.openReady(openTab, '<title>AAAAAAAAAAAAAAAAAAAAAAAA</title><h1>altra</h1>');
  await testServer.openReady(openTab, '<title>sito</title><h1>in vista</h1>', { pubblico: true });
  const sito = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  await expect.poll(async () => {
    const { attiva, tutte } = await schede(app);
    return tutte.find((t) => t.id === attiva)?.url || '';
  }).toMatch(/^http:\/\/sito-pubblico\.test/);

  const scatta = async () => {
    await new Promise((r) => setTimeout(r, 700));
    const r = await sito(chiedi('capture_feedback_topbar'));
    expect(r.nonTrovata || r.errore).toBeFalsy();
    return r.risposta?.dataUrl || '';
  };
  const primo = await scatta();
  await altra.evaluate(() => { document.title = 'WWWWWWWWWWWWWWWWWWWWWWWW'; });
  const secondo = await scatta();
  expect(primo === secondo, 'nella foto della barra che riceve il sito si leggono i titoli delle altre schede dell\'utente').toBe(true);
});
