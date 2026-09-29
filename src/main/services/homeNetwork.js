// La rete di casa vista dall'indirizzo da cui una pagina ha risposto davvero (#591): tplinkwifi.net intercettato dal
// router, un NAS raggiunto per nome. Non decide niente da sé: annota in SN_URL_NAV, la regola unica dei lavori automatici.
// Dietro un proxy risponde il proxy: l'indirizzo conta solo per una pagina arrivata diretta.

'use strict';

require('../../shared/urlNav.js');

const RESOLVE_TIMEOUT_MS = 3000;

function hostOf(url) {
  try { return new URL(String(url)).hostname; } catch (_) { return ''; }
}

function direct(ses, url) {
  if (typeof ses.resolveProxy !== 'function') return Promise.resolve(true);
  const late = new Promise((ok) => { const t = setTimeout(() => ok(false), RESOLVE_TIMEOUT_MS); if (t && t.unref) t.unref(); });
  const said = Promise.resolve().then(() => ses.resolveProxy(url))
    .then((r) => /^\s*DIRECT\s*;?\s*$/i.test(String(r || '')))
    .catch(() => false);
  return Promise.race([said, late]);
}

// La risposta del frame principale arriva prima del commit della navigazione: chi guarda la pagina al did-navigate
// (il controllo dei siti pericolosi) sa già da dove ha risposto, o aspetta che si sappia se è passata da un proxy.
function attach(ses) {
  if (!ses || !ses.webRequest || ses._filoReteDiCasa) return false;
  try {
    ses.webRequest.onResponseStarted({ urls: ['http://*/*', 'https://*/*'], types: ['mainFrame'] }, (d) => {
      if (!d || d.resourceType !== 'mainFrame' || !d.ip) return;
      const Nav = globalThis.SN_URL_NAV;
      const host = hostOf(d.url);
      // Si accerta solo quando l'indirizzo cambierebbe la risposta data dalla forma del nome.
      if (!Nav.isLanAddress(d.ip) && !Nav.isLocalHost(host)) { Nav.noteHostAddress(host, d.ip); return; }
      Nav.noteHostPending(host, direct(ses, d.url).then((ok) => {
        if (ok) Nav.noteHostAddress(host, d.ip); else Nav.forgetHostAddress(host);
      }));
    });
    ses._filoReteDiCasa = true;
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { attach, direct };
