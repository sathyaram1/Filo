// I siti che l'utente vuole sempre aperti (#823): dalla parola detta in chat alla voce salvata in memoria, e ritorno.
// Non decide la pulizia: la regola la applica TabManager._triageCandidates. Forma e confronto delle voci: SN_TAB_TRIAGE.

'use strict';

const { getDomainInfo } = require('./safebrowse/psl');

const T = () => globalThis.SN_TAB_TRIAGE;
const FM = () => globalThis.SN_FILO_MEMORY;

// La voce per `input` (dominio o indirizzo), o '' se non è un sito. Un suffisso pubblico («co.uk», «github.io»)
// terrebbe aperto mezzo web: lo è se un nome subito sotto di lui è già un sito a sé.
function voceDa(input) {
  const host = T().hostTenuto(input);
  if (!host) return '';
  // Una macchina senza punto (localhost, il NAS) non ha suffissi pubblici: per la lista sarebbe un dominio di primo livello.
  if (!host.includes('.') || host.startsWith('[')) return host;
  const sotto = getDomainInfo(`a.${host}`, { soloPsl: true });
  return sotto && sotto.registrable === `a.${host}` ? '' : host;
}

async function voci() {
  return Object.keys(await FM().listKeepOpen());
}

async function aggiungi(voce) {
  return voce ? FM().addKeepOpen(voce) : null;
}

// Le voci che «non tenere più aperto `input`» toglie, senza toglierle.
async function daTogliere(input) {
  return T().vociDaTogliere(input, await voci());
}

module.exports = { voceDa, voci, aggiungi, daTogliere };
