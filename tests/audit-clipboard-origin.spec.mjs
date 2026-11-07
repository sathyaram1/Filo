// Dal suo mondo (main world) una pagina web non legge e non scrive la cronologia appunti di Filo. Il window.chrome che
// vede è la maschera di preload/mondo-chrome.js (#1616), voluta: si prova l'esito, non l'assenza di chrome.runtime.
// Le regole del canale di Filo dentro le pagine: tests/appunti-dai-siti.spec.mjs.

import { test, expect } from './fixtures/electron.mjs';

const SEGRETO = 'AUDIT_CLIP_SENTINELLA_UNIVOCA_XK7Q';
const MONDO_CONTENT_SCRIPT = 999;
const PAGINA = '<!doctype html><html><body style="padding:40px"><button id="ok">Accetta</button><textarea id="ta" rows="5" cols="50"></textarea></body></html>';

const cronologia = (shell) => shell.evaluate(async () => {
  const r = await window.filoShell.message({ type: 'get_clipboard_history' });
  return (r && r.items || []).filter((i) => i.type === 'text').map((i) => i.text);
});

// Il canale vero di Filo, quello dei suoi script nella pagina: il controllo che il momento scelto gli era favorevole.
function dalCanaleDiFilo(app, msg) {
  return app.evaluate(async ({ BrowserWindow }, { m, mondo }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => /^http:\/\/127\.0\.0\.1:/.test(String(t.url || '')));
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code: `chrome.runtime.sendMessage(${JSON.stringify(m)})` }]);
  }, { m: msg, mondo: MONDO_CONTENT_SCRIPT });
}

// Ogni forma con cui una pagina può bussare a chrome.runtime: ritorna tutto ciò che le è tornato indietro.
function bussaDalMondoDellaPagina(page, msg) {
  return page.evaluate(async (m) => {
    const tornato = [];
    const prendi = (v) => { try { tornato.push(JSON.stringify(v) ?? 'undefined'); } catch (e) { tornato.push(String(v)); } };
    const rt = window.chrome && window.chrome.runtime;
    if (!rt) return tornato;
    const tentativi = [
      () => rt.sendMessage(m),
      () => rt.sendMessage(m, prendi),
      () => rt.sendMessage('filo', m),
      () => rt.sendMessage('filo', m, {}, prendi),
      () => { const p = rt.connect('filo'); p.onMessage.addListener(prendi); p.postMessage(m); },
    ];
    for (const t of tentativi) {
      try { const r = t(); prendi(r && typeof r.then === 'function' ? await r : r); } catch (e) { tornato.push(`errore: ${e && e.message}`); }
    }
    await new Promise((ok) => setTimeout(ok, 300));
    return tornato;
  }, msg);
}

test('una pagina web non può leggere la cronologia appunti di Filo dal suo mondo, nemmeno col menu Incolla aperto', async ({ app, shell, openTab, testServer }) => {
  const seme = await shell.evaluate((text) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text } }), SEGRETO);
  expect(seme).toEqual({ ok: true });

  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#ta').click({ button: 'right' });
  const daFilo = await dalCanaleDiFilo(app, { type: 'get_clipboard_history' });
  expect(JSON.stringify(daFilo), 'col menu aperto il canale di Filo nella pagina legge la cronologia').toContain(SEGRETO);

  const tornato = await bussaDalMondoDellaPagina(page, { type: 'get_clipboard_history' });
  expect(tornato.join('\n'), 'ciò che l’utente ha copiato non arriva agli script del sito').not.toContain(SEGRETO);
});

test('una pagina web non può aggiungere voci alla cronologia appunti via main world (contesto isolato)', async ({ app, shell, openTab, testServer }) => {
  const DAL_SITO = `${SEGRETO}_DAL_SITO`;
  const CONTROLLO = `${SEGRETO}_DAL_CANALE_DI_FILO`;
  const page = await testServer.openReady(openTab, PAGINA);
  // Subito dopo un clic vero dell'utente: il momento in cui il canale di Filo accetta una scrittura dal sito.
  await page.locator('#ok').click();

  await bussaDalMondoDellaPagina(page, { type: 'push_clipboard_entry', entry: { type: 'text', text: DAL_SITO } });
  const controllo = await dalCanaleDiFilo(app, { type: 'push_clipboard_entry', entry: { type: 'text', text: CONTROLLO } });
  expect(controllo, 'dopo il clic il canale di Filo nella pagina scrive').toMatchObject({ ok: true });

  await expect.poll(() => cronologia(shell)).toContain(CONTROLLO);
  expect(await cronologia(shell), 'il sito non mette voci sue fra gli appunti dell’utente').not.toContain(DAL_SITO);
});
