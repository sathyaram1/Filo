// Crediti sul server e chiave personale — la logica PURA condivisa fra main e
// pagine (feedback #598). Niente rete, niente Electron: gli unit test la
// caricano così com'è.
//
// - riconoscere «crediti finiti» in un errore del provider (402), che NON si
//   ritenta: OpenRouter rifiuta finché il tetto non sale;
// - la riga del registro d'uso, con i soli campi che le regole Firestore
//   accettano (hasOnly): una riga con un campo in più viene rifiutata, e un
//   registro che non si scrive è un abuso agli occhi della riconciliazione;
// - il testo che spiega all'utente cosa fare, in base a come sta usando Filo.

(function (global) {
  'use strict';

  // I campi di una riga del registro, nell'ordine. Sono gli stessi elencati
  // nelle regole Firestore (wallet-usage): cambiarli qui senza cambiarli lì
  // fa rifiutare ogni riga.
  const USAGE_FIELDS = Object.freeze([
    'pseudonym', 'at', 'action', 'model', 'servedBy',
    'promptTokens', 'completionTokens', 'costUsd', 'credits',
  ]);

  // 402 dal servizio AI = il tetto della chiave è esaurito (o l'account non ha
  // credito). Con la chiave personale vuol dire «crediti finiti».
  function isOutOfCredits(err) {
    if (!err) return false;
    const st = Number(err.status);
    if (st === 402) return true;
    const raw = String((err && err.message) || err || '');
    return /^OpenRouter(?:\s+\S+)?\s+402\b/.test(raw) || /insufficient credits|key limit exceeded/i.test(raw);
  }

  // Quanti crediti vale una spesa in dollari, coi parametri del server
  // (euro per credito, cambio). Per eccesso al decimo: ciò che si scala al
  // saldo mostrato non deve essere meno di ciò che OpenRouter conta.
  function creditsForUsd(costUsd, { eurPerCredit, eurUsd } = {}) {
    const usd = Number(costUsd);
    if (!Number.isFinite(usd) || usd <= 0) return 0;
    const e = Number(eurPerCredit) || 0.0007;
    const fx = Number(eurUsd) || 1.1;
    return Math.ceil((usd / (e * fx)) * 10 - 1e-6) / 10;
  }

  // Costruisce la riga, scartando tutto ciò che non è nel contratto. `at` è
  // ISO UTC: il server confronta per intervallo di tempo.
  function usageRow({ pseudonym, at, action, model, servedBy, usage, costUsd, credits } = {}) {
    if (!pseudonym) return null;
    const u = usage || {};
    const usd = Number(costUsd != null ? costUsd : u.costUsd);
    return {
      pseudonym: String(pseudonym),
      at: at || new Date().toISOString(),
      action: String(action || ''),
      model: String(model || ''),
      servedBy: String(servedBy || ''),
      promptTokens: Math.max(0, Math.floor(Number(u.promptTokens) || 0)),
      completionTokens: Math.max(0, Math.floor(Number(u.completionTokens) || 0)),
      costUsd: Number.isFinite(usd) && usd > 0 ? usd : 0,
      credits: Math.max(0, Number(credits) || 0),
    };
  }

  // Il messaggio per l'utente quando la chiamata è stata rifiutata per crediti.
  //   usingOwnKey: la chiamata è partita con una chiave dell'utente (non quella
  //                personale di Filo): allora è il SUO conto OpenRouter.
  //   dailyCredits: quota giornaliera, se nota, per dire quanto arriva domani.
  function outOfCreditsMessage({ usingOwnKey = false, dailyCredits = null } = {}) {
    if (usingOwnKey) {
      return 'la tua chiave OpenRouter non ha più credito: ricarica il tuo account OpenRouter, oppure togli la chiave dalle Impostazioni per tornare ai crediti di Filo.';
    }
    const domani = dailyCredits ? ` (domani ne arrivano ${dailyCredits})` : '';
    return `i crediti di Filo sono finiti${domani}. Puoi aspettare quelli di domani, oppure mettere una tua chiave OpenRouter nelle Impostazioni.`;
  }

  // Gli esiti del riscatto, tradotti. `status` è quello del server.
  const REDEEM_MESSAGES = Object.freeze({
    ok: 'Invito riscattato: i tuoi crediti sono pronti.',
    invalid_code: 'Questo codice non esiste. Controlla di averlo copiato tutto.',
    code_used: 'Questo codice è già stato usato.',
    own_code: 'È un tuo codice: dallo a qualcun altro.',
    already_in: 'Hai già i tuoi crediti su questa installazione.',
    invites_exhausted: 'Per ora i posti sono finiti: riprova fra qualche giorno.',
    global_cap: 'Per ora non possiamo dare altri crediti: riprova fra qualche giorno.',
    missing_exchange_rate: 'Il server non è ancora pronto (manca il cambio del giorno): riprova fra qualche minuto.',
    not_configured: 'Il server non è ancora configurato per i crediti.',
    provider_error: 'Il servizio dei modelli non ha risposto: riprova fra poco.',
    internal: 'Qualcosa è andato storto sul server: riprova.',
    not_reachable: 'Non riesco a raggiungere il server: controlla la connessione.',
  });

  function redeemMessage(status) {
    return REDEEM_MESSAGES[status] || REDEEM_MESSAGES.internal;
  }

  // Il codice dentro quello che l'utente incolla. Il codice arriva per
  // messaggio e si ricopia com'è, spesso con la riga intorno («Codice:
  // ABCD-EFGH», «il tuo invito è abcd efgh»): se il testo, ripulito, non è un
  // codice, si cerca dentro un blocco di otto caratteri (anche quattro più
  // quattro) staccato dal resto. Se non c'è, torna il testo com'era: sarà il
  // server a dire «non esiste».
  function extractCode(raw) {
    const s = String(raw || '').trim();
    const norm = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (norm.length === 8) return norm;
    const m = s.toUpperCase().match(/(?<![A-Z0-9])([A-Z0-9]{4})[\s-]*([A-Z0-9]{4})(?![A-Z0-9])/);
    return m ? m[1] + m[2] : s;
  }

  global.SN_WALLET = { USAGE_FIELDS, isOutOfCredits, creditsForUsd, usageRow, outOfCreditsMessage, redeemMessage, extractCode, REDEEM_MESSAGES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
