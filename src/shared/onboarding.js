// Onboarding: la micro-intervista del primo avvio. Qui la parte PURA (elenco, stato della
// conversazione, chiusura, resa per il prompt), testabile senza Electron e senza LLM.
// REGOLA: il segno «già accolto» si scrive alla FINE, o chi chiude a metà non lo rivede.

(function (global) {
  'use strict';

  // Primo messaggio: testo FISSO, scritto a mano. È quello su cui l'utente giudica Filo,
  // quindi non lo genera il modello; dal secondo in poi parla lui.
  const WELCOME_MESSAGE =
    'Ciao, sono Filo. Se mi dai due minuti ti faccio qualche domanda e ti dico '
    + 'un paio di cose su di me. Alla fine mi trovi già impostato come vuoi tu, '
    + 'e ti preparo la tua home.\n'
    + 'Comincio io. Chi sei, e a cosa ti serve di solito il computer?\n'
    + 'Se non ti va, scrivi «basta così» e chiudiamo. Vado avanti coi valori '
    + 'predefiniti.';

  // Riprendendo un'intervista a metà la conversazione ricompare com'era e l'ultima bolla di
  // Filo È la domanda in sospeso: questa riga la introduce, così non sembra un déjà vu.
  const RESUME_NOTE = 'Bentornato. Eravamo rimasti qui.';

  // Quando a chiudere è l'APP e non il modello l'ultima bolla è questa: fissa e disponibile
  // anche senza rete, perché è l'unica cosa che l'utente vede prima della home.
  const CLOSING_MESSAGE =
    'Va bene, chiudo qui. Vado avanti coi valori predefiniti e imparo strada '
    + 'facendo.\n'
    + 'Se cambi idea la rifacciamo quando vuoi, da Preferenze → «Rifai '
    + 'l’intervista di benvenuto».';

  // Cinque scambi in tutto, salvo che sia l'utente ad allungare.
  const MAX_EXCHANGES = 5;
  // Tetto duro: l'intervista non può diventare infinita nemmeno se il modello si dimentica
  // di chiuderla.
  const HARD_MAX_EXCHANGES = 12;
  // Cap difensivo sulla conversazione salvata (serve solo a riprendere).
  const THREAD_CAP = 60;
  // Quante interviste passate si tengono da parte quando l'utente la rifà.
  const PAST_CAP = 5;

  // Le cose che Filo vuole SCOPRIRE e quelle che vuole DIRE. `applica` dice cosa fare appena
  // la cosa è nota: applicare subito ciò che si impara è metà del punto dell'intervista.
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
      detail: 'Cosa sono, che si entra con un codice d’invito dalla pagina Crediti, che ogni giorno ne arrivano altri e si accumulano, e che le segnalazioni li fanno guadagnare. Stanno su questa installazione: non promettere che sopravvivano a una reinstallazione. L’accesso Google serve per votare e per il red team, non per i crediti.',
    },
  ];

  const ITEM_IDS = ITEMS.map((i) => i.id);
  const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

  // La parola di stop la riconosce l'APP prima di ogni chiamata: affidarla al modello non è
  // una promessa. Un rifiuto no: «no grazie» è un no a QUELLA proposta, non un congedo.
  const STOP_PHRASES = [
    'basta', 'basta cosi', 'basta con le domande', 'basta domande',
    'basta le domande', 'niente intervista', 'niente domande',
    'salta', 'saltiamo', 'saltala', 'salta questa', 'salta pure', 'salta tutto',
    'salta l accoglienza', 'salta l intervista', 'salta la presentazione',
    'salta le domande', 'saltiamo l intervista', 'saltiamo tutto',
    'chiudi', 'chiudiamo', 'chiudi qui', 'chiudiamo qui', 'chiudila',
    'finiamola', 'finiscila', 'stop', 'stop cosi',
  ];
  const DECLINE_PHRASES = [
    'lascia stare', 'lascia perdere', 'lasciamo stare', 'lasciamo perdere',
    'non mi va', 'non ho voglia', 'non ora', 'non adesso', 'no grazie',
    'magari dopo', 'magari un altra volta', 'un altra volta', 'piu tardi',
    'salto', 'passo', 'forse dopo', 'ci penso',
  ];
  // Un «no» secco non sta in nessuno dei due elenchi: durante l'intervista è la risposta a
  // una domanda, e fuori non vuol dire niente di deciso.
  const STOP_SET = new Set(STOP_PHRASES);
  const DECLINE_SET = new Set(DECLINE_PHRASES);
  // Riempitivi di cortesia: si tolgono e si riprova. Attenzione a «no grazie» — togliere
  // «grazie» lascerebbe «no»: per questo l'insieme si controlla PRIMA di ogni sfrondatura.
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

  // Cerca la frase INTERA, togliendo mano a mano i riempitivi («ok basta così, grazie»).
  function matchesPhrase(set, text) {
    let p = normalizePhrase(text);
    // Un messaggio lungo è una risposta all'intervista, non un modo di uscirne.
    if (!p || p.length > 60) return false;
    for (let i = 0; i < 4; i++) {
      if (set.has(p)) return true;
      const next = p.replace(POLITE_HEAD, '').replace(POLITE_TAIL, '').trim();
      if (next === p) break;
      p = next;
    }
    return set.has(p);
  }

  // «basta così», «salta», «stop»: chiedono di uscire, e non vogliono dire
  // altro. Chiudono l'intervista senza chiamare nessuno.
  function isStopRequest(text) {
    return matchesPhrase(STOP_SET, text);
  }

  // «no grazie», «magari dopo», «non ora»: rifiutano. Da sole non dicono COSA —
  // lo dice la domanda a cui rispondono.
  function isDecline(text) {
    return matchesPhrase(DECLINE_SET, text);
  }

  // C'è una battuta di Filo a cui rispondere? Durante l'intervista Filo parla per primo, il
  // benvenuto è già nella conversazione, quindi l'utente risponde sempre a qualcosa.
  function repliesToFilo(state) {
    return normalize(state).thread.some((m) => m.role === 'filo');
  }

  // La decisione dell'app in un posto solo: un'uscita esplicita chiude senza modello, un
  // rifiuto resta al modello, che ha davanti la domanda — se c'è una domanda a cui riferirsi.
  function isExitRequest(state, text) {
    if (isStopRequest(text)) return true;
    if (!isDecline(text)) return false;
    return !repliesToFilo(state);
  }

  function emptyState() {
    return {
      done: false, ticked: [], thread: [], past: [],
      startedAt: null, closedAt: null, notice: '',
    };
  }

  // Una conversazione conta solo se l'utente ha risposto: il solo benvenuto a schermo non è
  // niente che qualcuno voglia rileggere.
  function hasUserTurn(thread) {
    return Array.isArray(thread) && thread.some((m) => m && m.role === 'user');
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

  // Rende utilizzabile qualsiasi cosa arrivi dallo storage (assente, vecchia, manomessa):
  // mai un throw sul cammino di apertura della home.
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
        // Solo le conversazioni VERE: una senza risposte occupava un posto dei cinque, e cinque
        // rilanci a vuoto buttavano fuori la prima. Il filtro sta qui, così ripulisce l'esistente.
        .filter((p) => hasUserTurn(p.thread))
        .slice(-PAST_CAP)
      : [];
    return {
      done: !!s.done,
      ticked: Array.from(new Set(ticked)),
      thread: normalizeThread(s.thread),
      past,
      startedAt: s.startedAt || null,
      closedAt: s.closedAt || null,
      // 'early' = chiusa prima di aver finito: la home lo dice, con la strada per rifarla, e si
      // spegne appena l'utente l'ha letto.
      notice: s.notice === 'early' ? 'early' : '',
    };
  }

  function isActive(state) {
    return !normalize(state).done;
  }

  function isTicked(state, id) {
    return normalize(state).ticked.includes(String(id || '').toLowerCase());
  }

  // Gli id sconosciuti si ignorano: si torna l'elenco dei riconosciuti, così il chiamante
  // non annuncia una spunta che non è avvenuta.
  function tick(state, ids) {
    const cur = normalize(state);
    const list = Array.isArray(ids) ? ids : [ids];
    const valid = list
      .map((x) => String(x || '').trim().toLowerCase())
      .filter((x) => ITEM_BY_ID[x]);
    const next = { ...cur, ticked: Array.from(new Set([...cur.ticked, ...valid])) };
    return { state: next, applied: valid.filter((x) => !cur.ticked.includes(x)) };
  }

  // Da qui passano TUTTE le strade che chiudono l'intervista: è l'unico posto dove decidere
  // se serve una riga di spiegazione. Il congedo in chat dura poco, la riga sulla home resta.
  function close(state, nowIso) {
    const cur = normalize(state);
    if (cur.done) return cur;
    return {
      ...cur,
      done: true,
      closedAt: nowIso || new Date().toISOString(),
      notice: isComplete(cur) ? '' : 'early',
    };
  }

  // La riga sulla home è stata letta (o l'utente ha rifatto l'intervista): via.
  function dismissNotice(state) {
    return { ...normalize(state), notice: '' };
  }

  // Ricomincia da capo: l'intervista di PRIMA finisce nell'archivio invece di sparire, e si
  // archivia solo ciò che è davvero una conversazione (se ne tengono cinque).
  function restart(prev, nowIso) {
    const cur = normalize(prev);
    const at = nowIso || new Date().toISOString();
    const past = hasUserTurn(cur.thread)
      ? [...cur.past, {
        startedAt: cur.startedAt || null,
        closedAt: cur.closedAt || at,
        thread: cur.thread,
      }].slice(-PAST_CAP)
      : cur.past;
    return { ...emptyState(), past, startedAt: at };
  }

  // Le interviste conservate, dalla più recente: la corrente (appena ha una conversazione) e
  // quelle archiviate dai rilanci. È quello che Preferenze mostra per rileggerle.
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

  // Accoda un turno SALTANDO la ripetizione immediata dello stesso messaggio: è lo stesso
  // turno ripartito (finestra riaperta, «Riprova»), e contava per due dei cinque scambi.
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

  // Quanti messaggi ha scritto l'utente: è il conto degli «scambi» del tetto.
  function userTurns(state) {
    return normalize(state).thread.filter((m) => m.role === 'user').length;
  }

  // Turno rimasto a metà (l'ultima cosa è un messaggio dell'utente): chi riapre lo trova
  // ripartito da solo, senza dover riscrivere niente.
  function hasPendingTurn(state) {
    const cur = normalize(state);
    const last = cur.thread[cur.thread.length - 1];
    return !cur.done && !!last && last.role === 'user';
  }

  // Oltre il tetto duro l'intervista si chiude da sé, qualunque cosa faccia il modello:
  // un'accoglienza che non finisce mai è peggio di una incompleta.
  function shouldForceClose(state) {
    const cur = normalize(state);
    if (cur.done) return false;
    return isComplete(cur) || userTurns(cur) >= HARD_MAX_EXCHANGES;
  }

  // Elenco per il prompt: cosa resta da scoprire e da dire, con la spunta di ciò che è fatto.
  // Le istruzioni che lo avvolgono stanno in `PROMPTS.filoChatContext`.
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
    ITEMS, ITEM_IDS, STOP_PHRASES, DECLINE_PHRASES,
    emptyState, normalize, isActive, isTicked, tick, close, restart, conversations,
    remaining, isComplete, appendTurn, userTurns, hasPendingTurn, shouldForceClose,
    isStopRequest, isDecline, isExitRequest, dismissNotice, renderChecklistForPrompt,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
