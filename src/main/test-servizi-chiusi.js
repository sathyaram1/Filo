// Nelle prove (NODE_ENV=test, o FILO_SERVIZI_CHIUSI=1 dal pilota): i servizi veri di Filo (schede, funzioni, identità)
// non si raggiungono da nessuna porta, né dalle pagine né dal main: una prova parte uguale ovunque e non paga la produzione
// (#735.1, #2470). Chi li vuole li finge sopra (FILO_FUNCTIONS_BASE e simili). Sentinella: tests/unit/testServiziChiusi.test.mjs.

'use strict';

// Ogni lancio di prova creava un utente anonimo vero e chiamava le funzioni: 13 mila iscrizioni al giorno (#2470).
const HOST_CHIUSI = [
  'firestore.googleapis.com',
  'firebasestorage.googleapis.com',
  'europe-west1-filo-8b9cb.cloudfunctions.net',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
];

/** Vero se `url` punta a un servizio chiuso durante i test. PURA. */
function hostChiuso(url) {
  let host = '';
  try { host = new URL(String(url)).hostname.toLowerCase().replace(/\.$/, ''); } catch (_) { return false; }
  return HOST_CHIUSI.includes(host);
}

function urlDi(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return String(input || '');
}

/**
 * Avvolge `target.fetch` (quello di Node nel main): verso un host chiuso fallisce come
 * fallirebbe senza rete, il resto passa invariato. Ritorna true se ha avvolto.
 */
function chiudiFetch(target = globalThis, avvisa = () => {}) {
  if (!target || typeof target.fetch !== 'function' || target.fetch.__filoServiziChiusi) return false;
  const vera = target.fetch;
  const avvisati = new Set();
  const chiusa = function fetch(input, init) {
    const url = urlDi(input);
    if (hostChiuso(url)) {
      const host = new URL(url).hostname;
      if (!avvisati.has(host)) { avvisati.add(host); avvisa(`[test] servizio chiuso: ${host}`); }
      return Promise.reject(new TypeError('fetch failed'));
    }
    return vera.call(this, input, init);
  };
  chiusa.__filoServiziChiusi = true;
  target.fetch = chiusa;
  return true;
}

/** Vero in modalità test e quando chi apre Filo per una prova lo chiede a parte (il pilota degli agenti non è in modalità test). */
function serviziChiusiRichiesti(env = process.env) {
  return require('./test-window-mode').inModalitaTest(env) || (!!env && env.FILO_SERVIZI_CHIUSI === '1');
}

/**
 * Nelle prove chiude i servizi su ogni porta: il fetch del main e ogni sessione
 * delle pagine, anche quelle nate dopo (incognito, privacy). No-op altrimenti.
 */
function chiudiServiziNeiTest({
  inTest = serviziChiusiRichiesti(),
  app,
  cookies,
  avvisa = (riga) => { try { process.stderr.write(riga + '\n'); } catch (_) {} },
} = {}) {
  if (!inTest) return false;
  app = app || require('electron').app;
  cookies = cookies || require('./services/cookies');
  chiudiFetch(globalThis, avvisa);
  cookies.chiudiHost(hostChiuso);
  app.on('session-created', (ses) => { cookies.ensureRequestHook(ses); });
  app.whenReady().then(() => {
    try { cookies.ensureRequestHook(require('electron').session.defaultSession); } catch (_) {}
  }).catch(() => {});
  return true;
}

module.exports = { HOST_CHIUSI, hostChiuso, chiudiFetch, serviziChiusiRichiesti, chiudiServiziNeiTest };
