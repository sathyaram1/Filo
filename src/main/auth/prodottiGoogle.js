// YouTube, Gmail e Drive collegati nelle schede per chi è entrato in Filo prima che l'accesso passasse da una scheda
// (#1123): l'invito, una volta sola, e l'accesso web a Google con l'email già scritta. L'accesso a Filo sta in
// google-auth.js; i cookie dei domini di Google in services/accessoGoogle.js.

'use strict';

const cfg = require('./config');
const G = require('../../shared/dominiGoogle');

const DOPO = 'https://www.youtube.com/';
const INVITO = 'YouTube, Gmail e Drive nelle schede non sono ancora collegati al tuo account Google.';
const RIFIUTO = 'Google non accetta l\'accesso dentro Filo, quindi YouTube, Gmail e Drive nelle schede restano scollegati.';
const NON_CARICATA = 'La pagina d\'accesso di Google non si è caricata: controlla la connessione e riprova dal menu del profilo.';

function hostDi(url) {
  try { return new URL(String(url)).hostname.toLowerCase(); } catch (_) { return ''; }
}

// Un file e non la memoria: l'invito non torna a ogni avvio.
function fileInvito() {
  const { app } = require('electron');
  return require('node:path').join(app.getPath('userData'), 'invito-prodotti-google');
}
function invitoFatto() {
  try { return require('node:fs').existsSync(fileInvito()); } catch (_) { return true; }
}
function segnaInvitoFatto() {
  try { require('node:fs').writeFileSync(fileInvito(), String(Date.now())); } catch (_) {}
}

// Google ha già detto di no a una scheda: l'invito non lo ripropone.
function googleRifiutaLeSchede() {
  segnaInvitoFatto();
}

// Dopo l'accesso la scheda torna alla pagina di Google da cui si è partiti, altrimenti su YouTube.
function destinazione(daUrl) {
  return /^https:/i.test(String(daUrl || '')) && G.diGoogle(daUrl) ? String(daUrl) : DOPO;
}

// Una pagina d'accesso alla volta, come per l'accesso a Filo: chi lo richiede la ritrova davanti.
let schedaAperta = null;

function collega({ daUrl = '', finestra = null } = {}) {
  if (schedaAperta && schedaAperta.riporta()) return { ok: true };
  schedaAperta = null;
  const auth = require('./google-auth');
  const profilo = auth.getProfile();
  const url = new URL(cfg.webLoginEndpoint);
  if (profilo && profilo.email) url.searchParams.set('Email', profilo.email);
  url.searchParams.set('continue', destinazione(daUrl));
  segnaInvitoFatto();
  const host = hostDi(cfg.webLoginEndpoint);
  const scheda = require('./accessoInScheda').apri(url.toString(), {
    finestra,
    hostAccesso: host,
    // Uscita dalle pagine d'accesso: l'utente è dentro, il resto della scheda è suo.
    fino: (u) => !!hostDi(u) && hostDi(u) !== host,
    suRifiuto: (motivo) => {
      // Una pagina che non si carica non è un no di Google: l'invito resta.
      if (motivo !== 'rete') googleRifiutaLeSchede();
      const testo = motivo === 'rete' ? NON_CARICATA : RIFIUTO;
      try { require('../services/avvisoFinestra').avvisoNellaFinestra(testo, { chiave: 'prodotti-google-rifiutati', tipo: 'prodotti_google_rifiutati' }); } catch (_) {}
    },
  });
  if (!scheda) return { ok: false, error: 'Apri una finestra normale di Filo e riprova.' };
  schedaAperta = scheda;
  return { ok: true };
}

// All'avvio, a chi è dentro Filo e non ha Google nelle schede. `finestra`: dove mostrarlo.
async function invitaSeServe(finestra = null) {
  if (invitoFatto()) return false;
  const auth = require('./google-auth');
  if (!auth.isSignedIn()) return false;
  if (await require('../services/accessoGoogle').collegatoNelleSchede()) { segnaInvitoFatto(); return false; }
  const win = finestra || require('./accessoInScheda').finestraNormale();
  if (!win || win.isDestroyed()) return false;
  try {
    win.webContents.send('shell:toast', {
      text: INVITO,
      opts: { durationSec: 20, key: 'invito-prodotti-google', tipo: 'invito_prodotti_google', actions: [{ label: 'Collega', collegaGoogle: true }] },
    });
  } catch (_) { return false; }
  segnaInvitoFatto();
  return true;
}

module.exports = { collega, invitaSeServe, googleRifiutaLeSchede, destinazione };
