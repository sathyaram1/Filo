// La rete di casa vista dall'indirizzo da cui una pagina ha risposto davvero (#591): tplinkwifi.net intercettato dal
// router, un NAS raggiunto per nome. Non decide niente da sé: annota in SN_URL_NAV, la regola unica dei lavori automatici.

'use strict';

require('../../shared/urlNav.js');

function hostOf(url) {
  try { return new URL(String(url)).hostname; } catch (_) { return ''; }
}

// La risposta del frame principale arriva prima del commit della navigazione: chi guarda la pagina al did-navigate
// (il controllo dei siti pericolosi) sa già da dove ha risposto.
function attach(ses) {
  if (!ses || !ses.webRequest || ses._filoReteDiCasa) return false;
  try {
    ses.webRequest.onResponseStarted({ urls: ['http://*/*', 'https://*/*'], types: ['mainFrame'] }, (d) => {
      if (!d || d.resourceType !== 'mainFrame' || !d.ip) return;
      globalThis.SN_URL_NAV.noteHostAddress(hostOf(d.url), d.ip);
    });
    ses._filoReteDiCasa = true;
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { attach };
