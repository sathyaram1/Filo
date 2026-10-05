// #589.3 — un popup «Accedi con…» aperto da un sito è una finestra vera con dentro un sito:
// quello che chiede il codice di Filo lì dentro si rifiuta come dalla scheda del sito, e la
// barra di Filo continua ad averlo. Regola: finestraDellaBarra in src/main/ipc.js.

import { test, expect } from './fixtures/electron.mjs';

const MONDO_CONTENT_SCRIPT = 999;

// Porte che un sito non apre: dati dell'utente, disco, account.
const PORTE_CHIUSE = [
  { type: 'filo_chats_list' },
  { type: 'filo_chat_delete', id: 'chat-inesistente' },
  { type: 'filo_get_onboarding' },
  { type: 'downloads_list' },
  { type: 'download_open_file', id: 'dl-inesistente', confirmed: true },
  { type: 'wallet_state' },
  { type: 'permessi_siti_get' },
  { type: 'auth_signout' },
];

function chiediDa(app, trova) {
  return (msg) => app.evaluate(async ({ webContents }, { trova, m, mondo }) => {
    const wc = webContents.getAllWebContents()
      .filter((w) => !w.isDestroyed() && String(w.getURL()).includes(trova)).pop();
    if (!wc) throw new Error(`nessuna pagina su ${trova}`);
    const code = `chrome.runtime.sendMessage(${JSON.stringify(m)})`;
    return wc.executeJavaScriptInIsolatedWorld(mondo, [{ code }]);
  }, { trova, m: msg, mondo: MONDO_CONTENT_SCRIPT });
}

async function apriPopupDiAccesso(app, testServer, openTab) {
  const sito = await testServer.openReady(openTab, '<h1>sito con «Accedi con…»</h1>');
  const login = `${testServer.html('<h1>accedi</h1>')}?client_id=filo589&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await sito.evaluate((u) => { window.open(u, '_blank', 'width=480,height=600'); }, login);
  // Il popup è una finestra senza schede, col codice di Filo montato come su ogni pagina.
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes('client_id=filo589'));
    if (!w) return 'nessun popup';
    try { return await w.webContents.executeJavaScript('document.documentElement.dataset.filoContentReady || "non pronto"'); } catch (_) { return 'non pronto'; }
  }), { timeout: 10000 }).toBe('1');
  return { sito, dalPopup: chiediDa(app, 'client_id=filo589') };
}

test('dal popup di accesso aperto da un sito le porte di Filo restano chiuse, come dalla scheda', async ({ app, shell, openTab, testServer }) => {
  const { sito, dalPopup } = await apriPopupDiAccesso(app, testServer, openTab);
  const dallaScheda = chiediDa(app, new URL(sito.url()).host + '/');

  for (const msg of PORTE_CHIUSE) {
    const popup = await dalPopup(msg);
    const scheda = await dallaScheda(msg);
    expect(scheda?.error, `la scheda del sito ha avuto risposta a ${msg.type}`).toBe('forbidden');
    expect(popup?.error, `il popup di accesso ha avuto risposta a ${msg.type}: ${JSON.stringify(popup)}`).toBe('forbidden');
  }

  // La barra di Filo le stesse domande le fa ancora.
  for (const type of ['filo_chats_list', 'downloads_list', 'filo_get_onboarding']) {
    const r = await shell.evaluate((t) => window.filoShell.message({ type: t }), type);
    expect(r?.ok, `la barra di Filo non ha più risposta a ${type}: ${JSON.stringify(r)}`).toBe(true);
  }
});

test('nel popup di accesso il codice di Filo continua ad avere quello che spetta a un sito', async ({ app, openTab, testServer }) => {
  const { dalPopup } = await apriPopupDiAccesso(app, testServer, openTab);
  const impostazioni = await dalPopup({ type: 'get_settings' });
  expect(impostazioni?.ok, JSON.stringify(impostazioni)).toBe(true);
  expect(typeof impostazioni?.settings?.theme).toBe('string');
  const stato = await dalPopup({ type: 'auth_status' });
  expect(typeof stato?.signedIn).toBe('boolean');
});
