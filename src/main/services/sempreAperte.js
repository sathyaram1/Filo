// I siti che l'utente vuole sempre aperti (#823): dalla parola detta in chat alla voce salvata in memoria, e ritorno.
// Non decide la pulizia: la regola la applica TabManager._triageCandidates. Forma e confronto delle voci: SN_TAB_TRIAGE.

'use strict';

const { getDomainInfo } = require('./safebrowse/psl');
const { dominioDiPrimoLivello } = require('../../shared/stessoSito.js');

const T = () => globalThis.SN_TAB_TRIAGE;
const FM = () => globalThis.SN_FILO_MEMORY;

// La voce per `input` (dominio o indirizzo), o '' se non è un sito. Un suffisso pubblico («co.uk», «github.io»)
// terrebbe aperto mezzo web: lo è se un nome subito sotto di lui è già un sito a sé.
// `daScheda`: `input` è l'indirizzo di una scheda aperta, quindi di una macchina che esiste.
function voceDa(input, { daScheda = false } = {}) {
  const host = T().hostTenuto(input);
  if (!host) return '';
  if (host.startsWith('[')) return host;
  // Una macchina senza punto (localhost, il NAS) sì; un dominio di primo livello detto nudo («https://com») no. Con la
  // porta o da una scheda aperta è una macchina di casa che si chiama così («casa:8123»), e la voce copre solo lei.
  if (!host.includes('.')) return dominioDiPrimoLivello(host) && !daScheda && !conPorta(input) ? '' : host;
  const sotto = getDomainInfo(`a.${host}`, { soloPsl: true });
  return sotto && sotto.registrable === `a.${host}` ? '' : host;
}

function conPorta(input) {
  return /^(?:[a-z][a-z0-9+.-]*:\/\/)?[^\s/?#:@]+:\d{1,5}(?:[/?#]|$)/i.test(String(input == null ? '' : input).trim());
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
