// Onboarding: la micro-intervista del primo avvio (#524).
//
// Filo accoglie l'utente con UNA conversazione, non con un modulo a passi:
// sa cosa vuole scoprire e cosa vuole dire, lo fa nell'ordine che la
// conversazione suggerisce, applica subito quello che impara e alla fine si
// ricorda tutto. Questo modulo è la parte PURA di quel meccanismo — l'elenco
// delle cose da spuntare, lo stato della conversazione e il testo che entra nel
// prompt della chat — così è testabile senza Electron e senza LLM.
//
// Chi fa cosa:
//   - qui: elenco, stato, spunte, chiusura, resa per il prompt;
//   - src/shared/filoMemory.js: persistenza dello stato (una chiave sola);
//   - src/main/services/handlers.js: azione ONBOARDING, iniezione nel prompt,
//     compattazione forzata + prima dashboard alla chiusura;
//   - src/pages/dashboard/dashboard.js: la chat che l'utente vede.
//
// REGOLA: il segno "già accolto" si scrive alla FINE. Chi chiude la finestra a
// metà intervista, riaprendo, ritrova la conversazione dov'era — prima veniva
// marcato accolto ancora prima di rispondere e non rivedeva più il benvenuto.
//
// Pattern IIFE su globalThis (come capabilities.js/patchNotes.js): caricato dal
// loader nel main e via <script> nelle pagine filo://.

(function (global) {
  'use strict';

  // Primo messaggio: testo FISSO, scritto a mano. È quello su cui l'utente
  // giudica Filo, quindi non lo genera il modello. Dal secondo in poi parla lui.
  const WELCOME_MESSAGE =
    'Ciao, sono Filo. Se mi dai due minuti ti faccio qualche domanda e ti dico '
    + 'un paio di cose su di me. Alla fine mi trovi già impostato come vuoi tu, '
    + 'e ti preparo la tua home.\n'
    + 'Comincio io. Chi sei, e a cosa ti serve di solito il computer?\n'
    + 'Se non ti va, scrivi «basta così» e chiudiamo. Vado avanti coi valori '
    + 'predefiniti.';

  // Quando l'utente riprende un'intervista lasciata a metà, la conversazione
  // ricompare com'era: l'ultima bolla di Filo È la domanda in sospeso. Questa
  // riga la introduce, così non sembra un déjà vu.
  const RESUME_NOTE = 'Bentornato. Eravamo rimasti qui.';

  // Quando a chiudere l'intervista è l'APP e non il modello (parola di stop,
  // pulsante «Salta l'accoglienza»), l'ultima bolla di Filo è questa: fissa,
  // scritta a mano, disponibile anche senza rete. Deve arrivare comunque, anche
  // quando il modello non risponde — è l'unica cosa che l'utente vede prima
  // della home.
  const CLOSING_MESSAGE =
    'Va bene, chiudo qui: vado avanti coi valori predefiniti e imparo strada '
    + 'facendo.\n'
    + 'Se cambi idea la rifacciamo quando vuoi, da Preferenze → «Rifai '
    + 'l’intervista di benvenuto».';

  // Cinque scambi in tutto, non di più, salvo che sia l'utente ad allungare.
  const MAX_EXCHANGES = 5;
  // Tetto duro: l'intervista non può diventare infinita nemmeno se il modello
  // si dimentica di chiuderla. Oltre questo, la chiude il codice.
  const HARD_MAX_EXCHANGES = 12;
  // Cap difensivo sulla conversazione salvata (serve solo a riprendere).
  const THREAD_CAP = 60;
  // Quante interviste passate si tengono da parte quando l'utente la rifà.
  const PAST_CAP = 5;

  // Le cose che Filo vuole SCOPRIRE (`scoprire`) e quelle che vuole DIRE
  // (`dire`). `applica` dice cosa fare appena la cosa è nota: applicare subito
  // ciò che si impara è metà del punto dell'intervista.
  const ITEMS = [
    {
      id: 'profilo',
      kind: 'scoprire',
      label: 'Chi è l’utente e a cosa gli serve il computer',
      detail: 'Lavoro, studio, svago, quali siti frequenta.',
      applica: 'Appena lo sai, emetti SALVA_LEZIONE con quello che hai imparato su di lui, in terza persona: alla fine dell’intervista finisce nel suo PROFILO.',
    },
    {
      id: 'stile',
      kind: 'scoprire',
      label: 'Come vuole che Filo gli parli',
      detail: 'Breve o dettagliato, «tu» o «lei», formale o no.',
      applica: 'Appena lo sai, emetti IMPOSTA_PREFERENZA con chiave "stile_agente" e il valore che descrive quello stile, e da lì in poi scrivi già così.',
    },
    {
      id: 'estetica',
      kind: 'dire',
      label: 'L’aspetto si cambia parlando',
      detail: 'Una frase, tipo «preferisci il tema scuro? dimmelo». Se te lo chiede, applicalo subito con IMPOSTA_PREFERENZA o IMPOSTA_ESTETICA.',
    },
    {
      id: 'privacy',
      kind: 'dire',
      label: 'La privacy è protetta già così',
      detail: 'Cookie rifiutati, pubblicità bloccate, siti pericolosi bloccati. Una frase, e che se ne può parlare o cambiare qualcosa.',
    },
    {
      id: 'modelli',
      kind: 'dire',
      label: 'L’impegno sui modelli',
      detail: 'Filo non paga i grandi laboratori chiusi tranne Anthropic, usa modelli a pesi aperti su fornitori indipendenti, e c’è un interruttore per restare solo su quelli. UNA riga, senza predica: «se ti interessa come scelgo i modelli e chi pago, chiedimelo». Se te lo chiede, leggi il documento con LEGGI_TRASPARENZA doc "models" prima di rispondere.',
    },
    {
      id: 'crediti',
      kind: 'dire',
      label: 'I crediti, in due righe',
      detail: 'Cosa sono, che si ricaricano ogni giorno, e che con l’accesso Google sopravvivono a una reinstallazione e le segnalazioni li fanno guadagnare. L’accesso è proposto, non obbligatorio.',
    },
  ];

  const ITEM_IDS = ITEMS.map((i) => i.id);
  const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

  function emptyState() {
    return { done: false, ticked: [], thread: [], startedAt: null, closedAt: null };
  }

  // Rende utilizzabile qualsiasi cosa arrivi dallo storage (assente, vecchia,
  // manomessa): mai un throw sul cammino di apertura della home.
  function normalize(raw) {
    const s = (raw && typeof raw === 'object') ? raw : {};
    const ticked = Array.isArray(s.ticked)
      ? s.ticked.map((x) => String(x || '').trim().toLowerCase()).filter((x) => ITEM_BY_ID[x])
      : [];
    const thread = Array.isArray(s.thread)
      ? s.thread
        .filter((m) => m && typeof m === 'object')
        .map((m) => ({ role: m.role === 'filo' ? 'filo' : 'user', text: String(m.text || '') }))
        .filter((m) => m.text)
        .slice(-THREAD_CAP)
      : [];
    return {
      done: !!s.done,
      ticked: Array.from(new Set(ticked)),
      thread,
      startedAt: s.startedAt || null,
      closedAt: s.closedAt || null,
    };
  }

  function isActive(state) {
    return !normalize(state).done;
  }

  function isTicked(state, id) {
    return normalize(state).ticked.includes(String(id || '').toLowerCase());
  }

  // Spunta una o più voci. Gli id sconosciuti vengono ignorati: torniamo
  // l'elenco di quelli riconosciuti così il chiamante sa cosa è cambiato
  // davvero (e non annuncia una spunta che non è avvenuta).
  function tick(state, ids) {
    const cur = normalize(state);
    const list = Array.isArray(ids) ? ids : [ids];
    const valid = list
      .map((x) => String(x || '').trim().toLowerCase())
      .filter((x) => ITEM_BY_ID[x]);
    const next = { ...cur, ticked: Array.from(new Set([...cur.ticked, ...valid])) };
    return { state: next, applied: valid.filter((x) => !cur.ticked.includes(x)) };
  }

  function close(state, nowIso) {
    const cur = normalize(state);
    if (cur.done) return cur;
    return { ...cur, done: true, closedAt: nowIso || new Date().toISOString() };
  }

  // Ricomincia da capo: è ciò che fa il pulsante in Preferenze. La
  // conversazione precedente non viene riproposta — si riparte dal benvenuto.
  function restart(nowIso) {
    return { ...emptyState(), startedAt: nowIso || new Date().toISOString() };
  }

  function remaining(state) {
    const cur = normalize(state);
    return ITEMS.filter((i) => !cur.ticked.includes(i.id));
  }

  function isComplete(state) {
    return remaining(state).length === 0;
  }

  function appendTurn(state, turn) {
    const cur = normalize(state);
    const role = turn && turn.role === 'filo' ? 'filo' : 'user';
    const text = String((turn && turn.text) || '');
    if (!text) return cur;
    const thread = [...cur.thread, { role, text }].slice(-THREAD_CAP);
    return { ...cur, thread, startedAt: cur.startedAt || new Date().toISOString() };
  }

  // Quanti messaggi ha scritto l'utente: è il conto degli "scambi" del tetto.
  function userTurns(state) {
    return normalize(state).thread.filter((m) => m.role === 'user').length;
  }

  // Oltre il tetto duro l'intervista si chiude da sé, qualunque cosa faccia il
  // modello: un'accoglienza che non finisce mai è peggio di una incompleta.
  function shouldForceClose(state) {
    const cur = normalize(state);
    if (cur.done) return false;
    return isComplete(cur) || userTurns(cur) >= HARD_MAX_EXCHANGES;
  }

  // Elenco per il prompt: che cosa resta da scoprire e da dire, con la spunta
  // di ciò che è già fatto. Le istruzioni che lo avvolgono stanno in
  // `PROMPTS.filoChatContext` (stesso schema di capabilities.js).
  function renderChecklistForPrompt(state) {
    const cur = normalize(state);
    const line = (i) => `- [${cur.ticked.includes(i.id) ? 'x' : ' '}] ${i.id} — ${i.label}. ${i.detail}`
      + (i.applica && !cur.ticked.includes(i.id) ? ` ${i.applica}` : '');
    const scoprire = ITEMS.filter((i) => i.kind === 'scoprire').map(line).join('\n');
    const dire = ITEMS.filter((i) => i.kind === 'dire').map(line).join('\n');
    return `DA SCOPRIRE (chiedi; se l’utente l’ha già detto, è già spuntata):\n${scoprire}\n\n`
      + `DA DIRE (una frase ciascuna, nel tono che la conversazione ha preso):\n${dire}`;
  }

  global.SN_ONBOARDING = {
    WELCOME_MESSAGE, RESUME_NOTE,
    MAX_EXCHANGES, HARD_MAX_EXCHANGES, THREAD_CAP,
    ITEMS, ITEM_IDS,
    emptyState, normalize, isActive, isTicked, tick, close, restart,
    remaining, isComplete, appendTurn, userTurns, shouldForceClose,
    renderChecklistForPrompt,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
