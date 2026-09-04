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

  // ── L'uscita che NON passa dal modello ────────────────────────────────────
  //
  // Il benvenuto promette: «scrivi "basta così" e chiudiamo». Una promessa che
  // dipende dalla buona volontà del modello non è una promessa: un modello
  // piccolo se ne dimentica (l'istruzione è una fra molte) e un provider giù
  // non risponde affatto — e chi apre Filo la prima volta senza rete resterebbe
  // chiuso dentro l'accoglienza, con davanti una frase che gli dice di scrivere
  // una cosa che non funziona. Perciò la parola di stop la riconosce l'APP,
  // prima di qualunque chiamata: il modello resta la strada normale, questa è
  // la rete di sicurezza.
  //
  // Il riconoscimento è volutamente STRETTO: l'intera frase deve essere una
  // richiesta di uscita, non contenerne una. «basta che tu non sia prolisso» è
  // una risposta all'intervista, non un modo di chiuderla — e chiudere per
  // sbaglio l'accoglienza di chi voleva farla è il danno opposto.
  const STOP_PHRASES = [
    'basta', 'basta cosi', 'basta con le domande', 'basta domande',
    'salta', 'saltiamo', 'saltala', 'salta questa', 'salta pure', 'salta tutto',
    'salta l accoglienza', 'salta l intervista', 'salta la presentazione',
    'chiudi', 'chiudiamo', 'chiudi qui', 'chiudiamo qui', 'chiudila',
    'finiamola', 'finiscila', 'stop', 'stop cosi',
    'lascia stare', 'lascia perdere', 'lasciamo stare', 'lasciamo perdere',
    'non mi va', 'non ho voglia', 'non ora', 'non adesso', 'no grazie',
    'magari dopo', 'magari un altra volta', 'un altra volta', 'piu tardi',
    'salto', 'passo', 'niente intervista', 'niente domande',
  ];
  const STOP_SET = new Set(STOP_PHRASES);
  // Riempitivi di cortesia: si tolgono e si riprova. Attenzione a «no grazie» —
  // togliere «grazie» lascerebbe «no», che durante l'intervista è la risposta a
  // una domanda, non un'uscita: per questo l'insieme si controlla PRIMA di ogni
  // sfrondatura, e «no» da solo non è mai una parola di stop.
  const POLITE_HEAD = /^(?:ok|okay|okey|va bene|vabbe|vabbene|no|si|eh|dai|ma|beh|mah|senti|guarda|scusa|per ora|per adesso|adesso|allora)\s+/;
  const POLITE_TAIL = /\s+(?:grazie|per favore|per piacere|per ora|per adesso|adesso|ora|dai|eh|va bene|ok|cosi)$/;

  function normalizePhrase(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // via gli accenti: «così» = «cosi»
      .replace(/[^a-z0-9 ]+/g, ' ') // via punteggiatura e apostrofi
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isStopRequest(text) {
    let p = normalizePhrase(text);
    // Un messaggio lungo è una risposta all'intervista, non un modo di uscirne.
    if (!p || p.length > 60) return false;
    for (let i = 0; i < 4; i++) {
      if (STOP_SET.has(p)) return true;
      const next = p.replace(POLITE_HEAD, '').replace(POLITE_TAIL, '').trim();
      if (next === p) break;
      p = next;
    }
    return STOP_SET.has(p);
  }

  function emptyState() {
    return { done: false, ticked: [], thread: [], past: [], startedAt: null, closedAt: null };
  }

  function normalizeThread(raw) {
    return Array.isArray(raw)
      ? raw
        .filter((m) => m && typeof m === 'object')
        .map((m) => ({ role: m.role === 'filo' ? 'filo' : 'user', text: String(m.text || '') }))
        .filter((m) => m.text)
        .slice(-THREAD_CAP)
      : [];
  }

  // Rende utilizzabile qualsiasi cosa arrivi dallo storage (assente, vecchia,
  // manomessa): mai un throw sul cammino di apertura della home.
  function normalize(raw) {
    const s = (raw && typeof raw === 'object') ? raw : {};
    const ticked = Array.isArray(s.ticked)
      ? s.ticked.map((x) => String(x || '').trim().toLowerCase()).filter((x) => ITEM_BY_ID[x])
      : [];
    const past = Array.isArray(s.past)
      ? s.past
        .filter((p) => p && typeof p === 'object')
        .map((p) => ({
          startedAt: p.startedAt || null,
          closedAt: p.closedAt || null,
          thread: normalizeThread(p.thread),
        }))
        .filter((p) => p.thread.length)
        .slice(-PAST_CAP)
      : [];
    return {
      done: !!s.done,
      ticked: Array.from(new Set(ticked)),
      thread: normalizeThread(s.thread),
      past,
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

  // Ricomincia da capo: è ciò che fa il pulsante in Preferenze. Si riparte dal
  // benvenuto, con l'elenco tutto da spuntare — ma l'intervista di PRIMA non si
  // butta: finisce nell'archivio, da dove si rilegge. Rifarla non è cancellare
  // quella che c'era (prima la sostituiva, e chi la rifaceva perdeva la sua
  // prima conversazione con Filo per sempre).
  function restart(prev, nowIso) {
    const cur = normalize(prev);
    const at = nowIso || new Date().toISOString();
    const past = cur.thread.length
      ? [...cur.past, {
        startedAt: cur.startedAt || null,
        closedAt: cur.closedAt || at,
        thread: cur.thread,
      }].slice(-PAST_CAP)
      : cur.past;
    return { ...emptyState(), past, startedAt: at };
  }

  // Le interviste conservate, dalla più recente: quella corrente (appena ha una
  // conversazione) e quelle archiviate dai rilanci. È quello che Preferenze
  // mostra per rileggerle.
  function conversations(state) {
    const cur = normalize(state);
    const list = cur.past.slice().reverse().map((p) => ({ ...p, current: false }));
    if (cur.thread.length) {
      list.unshift({
        startedAt: cur.startedAt, closedAt: cur.closedAt, thread: cur.thread, current: true,
      });
    }
    return list;
  }

  function remaining(state) {
    const cur = normalize(state);
    return ITEMS.filter((i) => !cur.ticked.includes(i.id));
  }

  function isComplete(state) {
    return remaining(state).length === 0;
  }

  // Accoda un turno alla conversazione salvata — SALTANDO la ripetizione
  // immediata dello stesso messaggio.
  //
  // Lo stesso messaggio subito dopo sé stesso non è un turno nuovo: è lo stesso
  // turno ripartito. Succede in tre modi, e tutti e tre passano di qui: la
  // finestra chiusa mentre Filo scriveva e riaperta (il turno riparte da solo),
  // il «Riprova» dopo un errore, una seconda scheda aperta durante l'attesa.
  // Ogni volta la risposta dell'utente finiva salvata due volte e contava per
  // due dei cinque scambi: un intoppo di rete costava una delle cose che Filo
  // doveva scoprire o dire.
  function appendTurn(state, turn) {
    const cur = normalize(state);
    const role = turn && turn.role === 'filo' ? 'filo' : 'user';
    const text = String((turn && turn.text) || '');
    if (!text) return cur;
    const last = cur.thread[cur.thread.length - 1];
    if (last && last.role === role && last.text.trim() === text.trim()) {
      return { ...cur, startedAt: cur.startedAt || new Date().toISOString() };
    }
    const thread = [...cur.thread, { role, text }].slice(-THREAD_CAP);
    return { ...cur, thread, startedAt: cur.startedAt || new Date().toISOString() };
  }

  // Quanti messaggi ha scritto l'utente: è il conto degli "scambi" del tetto.
  function userTurns(state) {
    return normalize(state).thread.filter((m) => m.role === 'user').length;
  }

  // C'è un turno rimasto a metà: l'ultima cosa nella conversazione è un
  // messaggio dell'utente, quindi Filo non ha ancora risposto. Chi riapre trova
  // il turno che riparte da solo, senza dover riscrivere niente.
  function hasPendingTurn(state) {
    const cur = normalize(state);
    const last = cur.thread[cur.thread.length - 1];
    return !cur.done && !!last && last.role === 'user';
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
    WELCOME_MESSAGE, RESUME_NOTE, CLOSING_MESSAGE,
    MAX_EXCHANGES, HARD_MAX_EXCHANGES, THREAD_CAP, PAST_CAP,
    ITEMS, ITEM_IDS, STOP_PHRASES,
    emptyState, normalize, isActive, isTicked, tick, close, restart, conversations,
    remaining, isComplete, appendTurn, userTurns, hasPendingTurn, shouldForceClose,
    isStopRequest, renderChecklistForPrompt,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
