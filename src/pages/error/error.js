// Pagina d'errore di rete (filo://error/error.html?url=…&code=…&desc=…).
// Caricata dal main (tabs.js) quando una navigazione fallisce o il renderer
// della scheda muore. Tutta la logica di parsing/traduzione vive in
// src/shared/netError.js (SN_NET_ERROR); qui solo il rendering e il "Riprova".
//
// NB: questa pagina gira anche in una view "esterna" (preload di pagina,
// contextIsolation attiva): niente chrome.* qui dentro — solo DOM standard.

(function () {
  'use strict';

  const NE = window.SN_NET_ERROR;
  const info = (NE && NE.parse(String(window.location.href))) || null;
  const target = (info && info.target) || null;
  const code = (info && info.code) || '';
  const desc = (info && info.desc) || '';

  const msg = NE ? NE.describe(code, desc) : { title: 'Impossibile caricare la pagina', hint: '', offline: false };

  // Host del bersaglio, per titolo scheda + riga sotto al titolo. textContent
  // ovunque: l'URL arriva dalla query string, mai iniettarlo come HTML.
  let host = '';
  try { host = target ? (new URL(target).host || target) : ''; } catch (_) { host = target || ''; }

  document.getElementById('err-title').textContent = msg.title;
  document.getElementById('err-host').textContent = host ? host : '';
  document.getElementById('err-hint').textContent = msg.hint || '';

  // Dettaglio tecnico in piccolo (es. "ERR_NAME_NOT_RESOLVED (-105)"): utile a
  // chi cerca aiuto o segnala il problema, invisibile come rumore per gli altri.
  const detailBits = [];
  if (desc) detailBits.push(desc);
  if (code && String(code) !== (NE && NE.CRASH_CODE)) detailBits.push(`(${code})`);
  document.getElementById('err-detail').textContent = detailBits.join(' ');

  // Il titolo del documento diventa il titolo della scheda (via
  // page-title-updated): il sito fallito, non più "Nuova scheda".
  document.title = host || msg.title;

  const retryBtn = document.getElementById('err-retry');
  function retry() {
    if (!target) return;
    // replace(): il tentativo non aggiunge un'ulteriore voce di cronologia
    // sopra la pagina d'errore. target è già validato (solo http/https/filo).
    try { window.location.replace(target); } catch (_) {}
  }
  if (target) {
    retryBtn.addEventListener('click', retry);
  } else {
    retryBtn.style.display = 'none';
  }

  // Errori "sei offline": appena la connessione torna, riprova da sola.
  if (msg.offline && target) {
    window.addEventListener('online', retry);
  }
})();
