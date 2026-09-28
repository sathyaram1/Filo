// Verifica #589 — giro 5, rilievo 1. La spinta a tutte le schede ritaglia le
// impostazioni, ma gli altri carichi che viaggiano sulla stessa spinta arrivano
// interi ai siti: l'intervista di benvenuto (che un sito non può CHIEDERE) e il
// messaggio della home. Si legge quello che arriva nel mondo dei content script.

import { test, expect } from '../../fixtures/electron.mjs';

const MONDO_CONTENT_SCRIPT = 999;
const RACCONTO = 'Mi chiamo Anna, lavoro al PRONTO-SOCCORSO-G5-589 e ho due figli';

async function nelContentScript(app, origine, codice) {
  return app.evaluate(async ({ webContents }, { origine, codice, mondo }) => {
    const wc = webContents.getAllWebContents().find((w) => String(w.getURL()).startsWith(origine));
    if (!wc) throw new Error('scheda del mini server non trovata');
    return wc.executeJavaScriptInIsolatedWorld(mondo, [{ code: codice }]);
  }, { origine, codice, mondo: MONDO_CONTENT_SCRIPT });
}

async function sitoInAscolto(app, openTab, testServer) {
  const sito = await testServer.openReady(openTab, '<!doctype html><p>Un sito qualunque.</p>');
  await sito.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await nelContentScript(app, testServer.origin, `
    globalThis.__g5 = [];
    chrome.runtime.onMessage.addListener((m) => { try { globalThis.__g5.push(JSON.stringify(m)); } catch (_) {} });
    true;
  `);
  return sito;
}

test('l\'intervista di benvenuto non arriva ai siti: un sito non la può chiedere, e non gli si spinge', async ({ app, shell, openTab, testServer }) => {
  void shell;
  await sitoInAscolto(app, openTab, testServer);

  // Un'intervista in corso, con dentro quello che l'utente ha raccontato di sé.
  await app.evaluate(async (_e, racconto) => {
    await globalThis.__filoStorage.set({ filo_onboarding: {
      done: false, ticked: [], notice: 'x',
      thread: [{ role: 'filo', text: 'Ciao! Raccontami di te.' }, { role: 'user', text: racconto }],
    } });
  }, RACCONTO);

  // Chiederla da un sito è vietato (è la regola di questo lavoro, dal verso delle letture).
  const chiesta = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: globalThis.SN_MSG.MSG.FILO_GET_ONBOARDING, peek: true },
    { tab: { url: 'http://sito.example/' }, url: 'http://sito.example/' },
  ));
  expect(chiesta?.ok).not.toBe(true);

  // La home segna come letta la riga dell'accoglienza: lo stato si salva e si annuncia.
  const r = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: globalThis.SN_MSG.MSG.FILO_ONBOARDING_NOTICE_SEEN },
    { url: 'filo://dashboard/dashboard.html' },
  ));
  expect(r?.ok, 'il salvataggio dell\'intervista non è partito: la prova non guarda quello che deve').toBe(true);

  await new Promise((res) => setTimeout(res, 1500));
  const ricevuti = await nelContentScript(app, testServer.origin, 'globalThis.__g5');
  const conIlRacconto = ricevuti.filter((m) => m.includes('PRONTO-SOCCORSO-G5-589'));
  expect(
    conIlRacconto.map((m) => JSON.parse(m).type),
    'quello che l\'utente ha raccontato nell\'intervista di benvenuto è stato spinto dentro la pagina di un sito',
  ).toEqual([]);
});

test('il messaggio della home non viene spinto ai siti', async ({ app, shell, openTab, testServer }) => {
  void shell;
  await sitoInAscolto(app, openTab, testServer);

  // La stessa spinta che fa la home quando si rigenera (o quando l'accoglienza si chiude).
  await app.evaluate(async () => {
    const H = globalThis.__filoHandlers;
    const MSG = globalThis.SN_MSG.MSG;
    const spingi = H.broadcastToTabs || globalThis.SN_BROADCAST_TABS;
    if (typeof spingi === 'function') {
      spingi({ type: MSG.FILO_DASHBOARD_UPDATED, message: 'Anna, domani hai la visita CARDIOLOGICA-G5-589', suggestions: [], ts: '' });
    } else {
      throw new Error('broadcastToTabs non raggiungibile');
    }
  });

  await new Promise((res) => setTimeout(res, 1500));
  const ricevuti = await nelContentScript(app, testServer.origin, 'globalThis.__g5');
  expect(
    ricevuti.filter((m) => m.includes('CARDIOLOGICA-G5-589')).map((m) => JSON.parse(m).type),
    'il messaggio della home, costruito su memoria e pagine salvate, è stato spinto dentro la pagina di un sito',
  ).toEqual([]);
});
