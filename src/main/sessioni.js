// Dove nascono le sessioni di Filo (#586).
//
// Una sessione è un profilo di navigazione: cookie, cache, storage, e i
// permessi che i siti hanno chiesto. Filo ne crea parecchie — quella di
// default, le partizioni effimere dell'incognito, un jar per sito in modalità
// privacy, una per ogni scheda "aperta da un altro paese", quella isolata in
// cui il safebrowse fa detonare i link sospetti — e ognuna, appena nasce,
// deve avere il gestore dei permessi addosso: senza, Electron concede tutto.
//
// Qui c'è l'unica porta: `sessioneDiPartizione` e `sessionePredefinita`. La
// rete di sicurezza vera è `app.on('session-created')` (src/main/main.js), che
// scatta anche per le sessioni che Electron crea da sé — quelle che nascono da
// `webPreferences.partition`, senza che nessuno chiami niente. Le due cose
// convivono di proposito: la porta rende esplicito chi crea cosa, l'evento
// copre chi la porta non la passa. Una sentinella negli unit test tiene
// `session.fromPartition` e `session.defaultSession` confinati in questo file.

const { session } = require('electron');
const Permessi = require('./services/permessiSito');

function proteggi(ses) {
  try { Permessi.installaSuSessione(ses); } catch (_) {}
  return ses;
}

// La sessione della partizione data, già protetta. `opts` è quello di Electron
// (es. { cache: false }).
function sessioneDiPartizione(partizione, opts) {
  const ses = opts ? session.fromPartition(partizione, opts) : session.fromPartition(partizione);
  return proteggi(ses);
}

// La sessione di default (quella delle schede normali), già protetta.
function sessionePredefinita() {
  return proteggi(session.defaultSession);
}

module.exports = { sessioneDiPartizione, sessionePredefinita, proteggi };
