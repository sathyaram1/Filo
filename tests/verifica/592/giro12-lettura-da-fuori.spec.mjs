// Verifica #592, giro 12 — quello che una pagina visitata si porta via
// LEGGENDO.
//
// I giri 4, 8, 9 e 10 hanno chiuso a una pagina visitata quasi tutto quello che
// SCRIVE: i campi delle impostazioni, le chiavi dello storage, i nomi dei
// messaggi, le azioni. Il lato LETTURA delle impostazioni è invece rimasto
// intero, con una cosa sola tolta dalla risposta — le chiavi API — e la ragione
// scritta accanto («le impostazioni servono a ogni script che gira nella
// pagina»).
//
// Ma nello stesso oggetto ci sono altre due credenziali: il modello di proxy,
// che porta dentro nome utente e password in chiaro, e la chiave del servizio
// anti-phishing. E c'è lo stile dell'agente, cioè proprio il testo che questo
// lavoro ha messo sotto conferma perché è contenuto dell'utente.
//
// Accanto a quel canale c'è lo stato dell'account, ammesso alle pagine visitate
// perché il banco di prova di sicurezza si apre da ogni pagina: risponde con
// email, nome, foto, identificativo e il fatto che l'utente sia l'owner, mentre
// al banco (src/content/redteamAttack.js) serve solo sapere SE c'è un accesso.
//
// Ogni prova fa la controprova dalla pagina interna, dove la stessa lettura
// deve continuare a passare: un divieto che vale per tutti non è una guardia.

import { test, expect } from '../../fixtures/electron.mjs';

const DA_WEB = { url: 'https://sito-ostile.example/pagina.html' };
const DA_FILO = { url: 'filo://preferences/preferences.html' };

const comeSeFosse = (app, messaggio, mittente) => app.evaluate(
  async (_e, { m, s }) => globalThis.SN_HANDLE_MESSAGE(m, s),
  { m: messaggio, s: mittente },
);

const SEGRETI = {
  proxy: 'http://utente-proxy:parolachiave-proxy@gate.esempio.net:7000',
  safeBrowsing: 'CHIAVE-SAFEBROWSING-SEGRETA',
  stile: 'Parlami come a un collega, senza giri di parole',
};

async function preparaImpostazioni(app) {
  await app.evaluate(async (_e, s) => {
    await globalThis.SN_STORAGE.updateSettings({
      agentStyle: s.stile,
      proxy: { datacenter: s.proxy, residential: s.proxy, bypass: '' },
      security: { safeBrowse: { enabled: true, safeBrowsingKey: s.safeBrowsing } },
      terminal: { enabled: true, shell: 'powershell' },
      apiKeys: { openrouter: 'CHIAVE-OPENROUTER', tavily: 'CHIAVE-TAVILY' },
    });
  }, SEGRETI);
}

test('le impostazioni lette da una pagina web non devono portarsi via le altre due credenziali', async ({ app }) => {
  await preparaImpostazioni(app);

  const r = await comeSeFosse(app, { type: 'get_settings' }, DA_WEB);
  const testo = JSON.stringify(r || {});

  // Questa è già a posto, ed è l'unica che qualcuno aveva tolto.
  expect(testo, 'la chiave API esce').not.toContain('CHIAVE-OPENROUTER');
  // Queste due stanno nello stesso oggetto e sono credenziali quanto quella.
  expect(testo, 'la password del proxy esce').not.toContain('parolachiave-proxy');
  expect(testo, 'la chiave del servizio anti-phishing esce').not.toContain(SEGRETI.safeBrowsing);

  // Controprova: dalla pagina interna le impostazioni arrivano intere.
  const interna = await comeSeFosse(app, { type: 'get_settings' }, DA_FILO);
  expect(JSON.stringify(interna || {})).toContain('parolachiave-proxy');
});

test("da una pagina web non si deve poter leggere lo stile dell'agente", async ({ app }) => {
  await preparaImpostazioni(app);

  const r = await comeSeFosse(app, { type: 'get_settings' }, DA_WEB);
  expect(JSON.stringify(r || {}), "lo stile dell'agente esce").not.toContain('come a un collega');

  const interna = await comeSeFosse(app, { type: 'get_settings' }, DA_FILO);
  expect(JSON.stringify(interna || {})).toContain('come a un collega');
});

test('da una pagina web non si deve poter leggere se Filo ha la shell del computer', async ({ app }) => {
  await preparaImpostazioni(app);

  const r = await comeSeFosse(app, { type: 'get_settings' }, DA_WEB);
  const s = (r && r.settings) || {};
  expect(s.terminal, 'la modalità terminale e la shell escono').toBeUndefined();
});

test('la porta gemella: lo stesso oggetto letto dal canale dello storage', async ({ app }) => {
  await preparaImpostazioni(app);
  const K = await app.evaluate(async () => globalThis.SN_CONST.STORAGE_KEYS);

  const r = await comeSeFosse(app, { type: '_storage:get', keys: [K.SETTINGS] }, DA_WEB);
  const testo = JSON.stringify(r || {});
  expect(testo, 'la password del proxy esce dal canale dello storage').not.toContain('parolachiave-proxy');
  expect(testo, 'la chiave anti-phishing esce dal canale dello storage').not.toContain(SEGRETI.safeBrowsing);
  expect(testo, "lo stile dell'agente esce dal canale dello storage").not.toContain('come a un collega');

  // Controprova: dalla pagina interna la stessa lettura passa.
  const interna = await comeSeFosse(app, { type: '_storage:get', keys: [K.SETTINGS] }, DA_FILO);
  expect(JSON.stringify(interna || {})).toContain('parolachiave-proxy');
});

test("da una pagina web lo stato dell'account non deve dire CHI è l'utente", async ({ app }) => {
  // Un accesso vero non si può fare in un contenitore senza portachiavi di
  // sistema, quindi qui si guarda la FORMA della risposta: sono i campi che, ad
  // accesso fatto, portano email, nome, foto e identificativo (getProfile /
  // getUid in src/main/auth/google-auth.js). A un indirizzo web non devono
  // arrivare affatto.
  const r = await comeSeFosse(app, { type: 'auth_status' }, DA_WEB);
  expect(Object.prototype.hasOwnProperty.call(r || {}, 'profile'),
    "la risposta a una pagina web porta il campo del profilo (email, nome, foto)").toBe(false);
  expect(Object.prototype.hasOwnProperty.call(r || {}, 'uid'),
    "la risposta a una pagina web porta l'identificativo dell'utente").toBe(false);
  expect(Object.prototype.hasOwnProperty.call(r || {}, 'isAdmin'),
    "la risposta a una pagina web dice se l'utente è l'owner").toBe(false);

  // Quello che al banco di prova dentro la pagina serve davvero deve restare.
  expect(Object.prototype.hasOwnProperty.call(r || {}, 'signedIn'),
    "il banco di prova non sa più se c'è un accesso").toBe(true);

  // Controprova: dalla pagina interna la risposta resta completa.
  const interna = await comeSeFosse(app, { type: 'auth_status' }, DA_FILO);
  expect(Object.prototype.hasOwnProperty.call(interna || {}, 'profile')).toBe(true);
});
