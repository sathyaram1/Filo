// Pagina d'errore di rete: la mostra il main quando una navigazione fallisce.
// Parsing e traduzione dei codici vivono in SN_NET_ERROR; qui solo rendering e «Riprova».
// Gira in una view esterna (contextIsolation): niente chrome.*, solo DOM standard.

(function () {
  'use strict';

  const NE = window.SN_NET_ERROR;
  const info = (NE && NE.parse(String(window.location.href))) || null;
  const target = (info && info.target) || null;
  const code = (info && info.code) || '';
  const desc = (info && info.desc) || '';

  const msg = NE ? NE.describe(code, desc, { altroPaese: !!(info && info.altroPaese) }) : { title: 'Impossibile caricare la pagina', hint: '', offline: false };

  // Host del bersaglio, per titolo scheda + riga sotto al titolo. textContent
  // ovunque: l'URL arriva dalla query string, mai iniettarlo come HTML.
  const host = target ? ((window.SN_NOMI_SITO && window.SN_NOMI_SITO.sitoDi(target)) || target) : '';

  document.getElementById('err-title').textContent = msg.title;
  document.getElementById('err-host').textContent = host ? host : '';
  document.getElementById('err-hint').textContent = msg.hint || '';

  // Dettaglio tecnico in piccolo: utile a chi cerca aiuto o segnala, rumore per gli altri.
  const detailBits = [];
  if (desc) detailBits.push(desc);
  if (code && String(code) !== (NE && NE.CRASH_CODE)) detailBits.push(`(${code})`);
  document.getElementById('err-detail').textContent = msg.blocked ? '' : detailBits.join(' ');
  if (msg.blocked) document.getElementById('page').classList.add('err-blocked');

  // Il titolo del documento è quello della scheda: il sito fallito, non «Nuova scheda».
  document.title = host || msg.title;

  const retryBtn = document.getElementById('err-retry');
  // Sul sito bloccato il bottone è «Apri comunque»: il main riconosce il salto da qui al bersaglio.
  if (msg.blocked) retryBtn.textContent = 'Apri comunque';
  // Per togliere il sito dalla lista per sempre: la scheda resta qui, e torna sul sito appena esce dalla lista.
  if (msg.blocked) document.getElementById('err-lista').hidden = false;
  function retry() {
    if (!target) return;
    // replace(): il tentativo non lascia una voce di cronologia sopra la pagina d'errore.
    // `target` è già validato altrove: solo http/https/filo.
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
