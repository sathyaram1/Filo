// Verifica #592, giro 12 — quello che una pagina visitata si porta via
// LEGGENDO.
//
// I giri 4, 8, 9 e 10 hanno chiuso a una pagina visitata quasi tutto quello che
// SCRIVE (le impostazioni, le chiavi dello storage, i messaggi, le azioni). Il
// lato LETTURA è rimasto com'era, con una sola cosa tolta dalla risposta: le
// chiavi API. Ma nello stesso oggetto ci sono altre due credenziali — il
// modello di proxy, che porta dentro nome utente e password, e la chiave del
// servizio anti-phishing — più lo stile dell'agente, cioè proprio il testo che
// questo lavoro ha messo sotto conferma, e la fotografia di tutte le difese.
//
// E accanto a quel canale c'è lo stato dell'account: da un indirizzo web
// risponde con l'email, il nome, la foto, l'identificativo e il fatto che
// l'utente sia l'owner. Alla pagina che lo chiede davvero (il banco di prova di
// sicurezza, src/content/redteamAttack.js) serve solo sapere SE c'è un accesso.
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

test('da una pagina web le impostazioni non devono portarsi via le credenziali del proxy e la chiave anti-phishing', async ({ app }) => {
  await preparaImpostazioni(app);

  const r = await comeSeFosse(app, { type: 'get_settings' }, DA_WEB);
  const testo = JSON.stringify(r || {});

  expect(testo, 'la chiave API esce').not.toContain('CHIAVE-OPENROUTER');
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
});

test('la porta gemella: lo stesso oggetto letto dal canale dello storage', async ({ app }) => {
  await preparaImpostazioni(app);
  const K = await app.evaluate(async () => globalThis.SN_CONST.STORAGE_KEYS);

  const r = await comeSeFosse(app, { type: '_storage:get', keys: [K.SETTINGS] }, DA_WEB);
  const testo = JSON.stringify(r || {});
  expect(testo, 'la password del proxy esce dal canale dello storage').not.toContain('parolachiave-proxy');
  expect(testo, 'la chiave anti-phishing esce dal canale dello storage').not.toContain(SEGRETI.safeBrowsing);
  expect(testo, "lo stile dell'agente esce dal canale dello storage").not.toContain('come a un collega');
});

test("da una pagina web lo stato dell'account non deve dire chi è l'utente", async ({ app }) => {
  // Un accesso finto: si sostituiscono le funzioni del modulo già caricato, che
  // è lo stesso oggetto che l'handler ha in mano.
  await app.evaluate(async () => {
    const auth = process.mainModule.require('./auth/google-auth');
    auth.isSignedIn = () => true;
    auth.isAdmin = () => true;
    auth.getUid = async () => 'uid-di-marta-123';
    auth.getProfile = () => ({
      email: 'marta.rossi@example.com', name: 'Marta Rossi',
      picture: 'https://foto.example/marta.jpg',
    });
  });

  const r = await comeSeFosse(app, { type: 'auth_status' }, DA_WEB);
  const testo = JSON.stringify(r || {});
  expect(testo, "l'email dell'utente esce").not.toContain('marta.rossi@example.com');
  expect(testo, 'il nome dell\'utente esce').not.toContain('Marta Rossi');
  expect(testo, "l'identificativo dell'utente esce").not.toContain('uid-di-marta-123');

  // Quello che al banco di prova nella pagina serve davvero continua ad arrivare.
  expect(r && r.signedIn, 'il banco di prova non sa più se c\'è un accesso').toBe(true);

  // Controprova: dalla pagina interna il profilo arriva.
  const interna = await comeSeFosse(app, { type: 'auth_status' }, DA_FILO);
  expect(JSON.stringify(interna || {})).toContain('marta.rossi@example.com');
});
