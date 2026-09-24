// #525 — archivio delle chat con Filo: la LOGICA PURA.
//
// Prima di questo modulo una chat con Filo viveva solo nella pagina aperta:
// tornando alla home spariva. Restava il registro interno con i primi 200
// caratteri di ogni messaggio, che serve all'agente delle lezioni e non
// all'utente. Una discussione di ieri non si recuperava da nessuna parte.
//
// La regola che governa tutto il resto: **si salva sempre tutto, si classifica
// per decidere cosa mostrare**. La classificazione (`conversazione` da
// rileggere / `comando` di servizio) decide SOLO cosa si vede in
// filo://archive, mai cosa si conserva. Un errore di classificazione così
// costa un clic in più; nell'altro verso costerebbe una chat persa per sempre.
//
// Qui dentro: niente storage, niente rete, niente Electron — solo funzioni
// testabili con `npm run test:unit`. La persistenza sta in
// src/main/services/filoChats.js, la classificazione LLM in handlers.js.
//
// Pattern IIFE su globalThis (vedi CLAUDE.md → "Convenzione IIFE").

(function (global) {
  'use strict';

  // I due tipi. `null` significa «non ancora classificata»: si mostra fra le
  // conversazioni, perché nel dubbio si fa vedere.
  const KIND_TALK = 'conversazione';
  const KIND_COMMAND = 'comando';
  const KINDS = [KIND_TALK, KIND_COMMAND];

  // Quanto è lungo un titolo generato prima di essere accorciato. Sta largo:
  // un titolo è una riga in un elenco, e tagliarlo a 30 caratteri produce
  // «Discussione sulla coscienza e…» dove ci sarebbe stato tutto.
  const TITLE_MAX = 80;

  // ── Titolo di ripiego ────────────────────────────────────────────────────
  // Quando il modello non c'è (nessuna chiave, limite di spesa raggiunto, rete
  // assente) la chat NON resta senza nome: prende il primo messaggio
  // dell'utente. Un titolo approssimativo si riconosce lo stesso; una riga
  // vuota in un elenco no.
  function fallbackTitle(messages) {
    const list = (Array.isArray(messages) ? messages : [])
      .filter((m) => m && String(m.text || '').trim());
    // Di norma il titolo di ripiego è la prima cosa che ha detto l'utente. Ma
    // una chat può non averne nemmeno una — l'utente ha scritto solo un comando
    // con lo slash, e a parlare è stato solo Filo: lì si prende la prima riga
    // che c'è. «Chat senza testo» su una chat piena di testo è una bugia in
    // elenco.
    const first = list.find((m) => m.role === 'user') || list[0];
    const raw = first ? String(first.text) : '';
    const oneLine = raw.replace(/\s+/g, ' ').trim();
    if (!oneLine) return 'Chat senza testo';
    return clampTitle(oneLine);
  }

  // Accorcia un titolo senza spezzare una parola a metà quando può evitarlo, e
  // senza lasciare un surrogato solitario (un'emoji tagliata a metà diventa un
  // glifo rotto). Contiamo per punto di codice, non per unità UTF-16.
  function clampTitle(s) {
    const str = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    const units = Array.from(str);
    if (units.length <= TITLE_MAX) return str;
    const cut = units.slice(0, TITLE_MAX).join('');
    const lastSpace = cut.lastIndexOf(' ');
    // Tagliamo sull'ultimo spazio solo se non buttiamo via mezzo titolo.
    const body = lastSpace > TITLE_MAX * 0.6 ? cut.slice(0, lastSpace) : cut;
    return `${body.trimEnd()}…`;
  }

  // ── Tipo ─────────────────────────────────────────────────────────────────
  // Normalizza quello che ha detto il modello. Tutto ciò che non è
  // riconoscibile come «comando» diventa «conversazione»: è il verso in cui
  // sbagliare costa un clic invece di una chat nascosta.
  function normalizeKind(value) {
    const v = String(value == null ? '' : value).trim().toLowerCase();
    if (!v) return KIND_TALK;
    if (v.startsWith('comando') || v === 'command' || v === 'comandi') return KIND_COMMAND;
    return KIND_TALK;
  }

  // Legge la risposta del classificatore. Accetta il JSON puro, il JSON dentro
  // un blocco markdown (```json … ```) e la risposta a una parola: i modelli
  // economici fanno tutte e tre le cose, e una risposta che non si riesce a
  // leggere non deve costare il titolo.
  function parseTriage(raw, messages) {
    const text = String(raw == null ? '' : raw).trim();
    let obj = null;
    if (text) {
      const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
      const candidate = fenced ? fenced[1] : text;
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try { obj = JSON.parse(candidate.slice(start, end + 1)); } catch (_) { obj = null; }
      }
    }
    const titleRaw = obj && (obj.titolo ?? obj.title ?? obj.nome);
    const kindRaw = obj && (obj.tipo ?? obj.kind ?? obj.categoria);
    const title = String(titleRaw == null ? '' : titleRaw).trim();
    return {
      title: title ? clampTitle(title) : fallbackTitle(messages),
      // Senza JSON leggibile può restare una parola sola in chiaro: vale come
      // risposta. Se non è nemmeno quella, resta «conversazione».
      kind: normalizeKind(kindRaw != null ? kindRaw : (obj ? '' : text)),
    };
  }

  // ── Trascrizione da mandare al classificatore ────────────────────────────
  // Testa e coda, mai un taglio muto in mezzo: una chat lunga si riconosce da
  // come comincia e da come finisce, e chi legge deve sapere che in mezzo
  // manca qualcosa (altrimenti «continua» sembra la fine della discussione).
  function transcriptForTriage(messages, maxChars) {
    const cap = Number(maxChars) > 0 ? Number(maxChars) : 4000;
    const lines = (Array.isArray(messages) ? messages : [])
      .filter((m) => m && String(m.text || '').trim())
      .map((m) => `${m.role === 'user' ? 'Utente' : 'Filo'}: ${String(m.text).replace(/\s+/g, ' ').trim()}`);
    const full = lines.join('\n');
    if (full.length <= cap) return full;
    const head = full.slice(0, Math.floor(cap * 0.6));
    const tail = full.slice(-Math.floor(cap * 0.4));
    return `${head}\n…(parte centrale della conversazione omessa)…\n${tail}`;
  }

  // ── Voce d'elenco ────────────────────────────────────────────────────────
  // Quello che la pagina Cronologia deve mostrare senza scaricarsi addosso
  // tutte le conversazioni: titolo, date, tipo, quanti messaggi, e un estratto
  // per far capire di cosa si parlava.
  function toIndexEntry(chat) {
    if (!chat || !chat.id) return null;
    const messages = Array.isArray(chat.messages) ? chat.messages : [];
    return {
      id: chat.id,
      title: chat.title || fallbackTitle(messages),
      kind: chat.kind || null,
      onboarding: !!chat.onboarding,
      startedAt: chat.startedAt || null,
      updatedAt: chat.updatedAt || chat.startedAt || null,
      closedAt: chat.closedAt || null,
      messageCount: messages.length,
      excerpt: excerptOf(messages, chat.title || fallbackTitle(messages)),
    };
  }

  // L'anteprima che sta accanto al titolo, in elenco. Di norma è il primo
  // messaggio dell'utente: è quello che fa capire di cosa si parlava.
  //
  // Ma quando il titolo NON è stato generato — la chat è ancora in corso,
  // oppure un modello per i titoli non c'è — il titolo È quel primo messaggio,
  // e la riga finiva per dire due volte la stessa frase, una accanto
  // all'altra. In quel caso l'anteprima passa oltre e mostra il pezzo DOPO:
  // così la riga aggiunge qualcosa invece di ripetersi. Se dopo non c'è
  // niente, meglio niente che un'eco.
  function excerptOf(messages, title) {
    const list = (Array.isArray(messages) ? messages : [])
      .filter((m) => m && String(m.text || '').trim());
    const primoUtente = list.findIndex((m) => m.role === 'user');
    const da = primoUtente >= 0 ? primoUtente : 0;
    const candidati = list.slice(da);
    const base = String(title == null ? '' : title).replace(/…$/, '').trim();
    for (const m of candidati) {
      const oneLine = String(m.text).replace(/\s+/g, ' ').trim();
      // «Già detto nel titolo» si riconosce dall'inizio, non dall'uguaglianza:
      // un titolo di ripiego è il messaggio accorciato, non il messaggio.
      if (base.length >= 8 && oneLine.startsWith(base)) continue;
      return oneLine.length > 180 ? `${oneLine.slice(0, 180)}…` : oneLine;
    }
    return '';
  }

  // Le chat che si VEDONO senza filtri: le conversazioni e quelle non ancora
  // classificate. I comandi ci sono sempre, ma stanno sotto il filtro.
  function isVisibleByDefault(chat) {
    return normalizeKindOrNull(chat && chat.kind) !== KIND_COMMAND;
  }

  function normalizeKindOrNull(value) {
    const v = String(value == null ? '' : value).trim().toLowerCase();
    if (!v) return null;
    return KINDS.includes(v) ? v : null;
  }

  // ── Ricerca per testo ────────────────────────────────────────────────────
  // Cerca in tutta la chat — titolo e testo di ogni messaggio — non solo nel
  // titolo: «riprendi la discussione sulla coscienza» deve trovare la chat
  // anche se quella parola sta a metà conversazione. Senza accenti e senza
  // maiuscole, perché chi cerca scrive «perche» e «PERCHÉ» indifferentemente.
  function normalizeForSearch(s) {
    let out = String(s == null ? '' : s).toLowerCase();
    try { out = out.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (_) {}
    return out;
  }

  function haystackOf(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : [];
    return normalizeForSearch([
      (chat && chat.title) || '',
      ...messages.map((m) => (m && m.text) || ''),
    ].join('\n'));
  }

  // Tutti i termini della query devono comparire (AND), in qualsiasi ordine:
  // «coscienza filosofia» trova la chat che parla di entrambe, non quella che
  // nomina solo la prima.
  function matches(chat, query) {
    const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const hay = haystackOf(chat);
    return terms.every((t) => hay.includes(t));
  }

  function search(chats, query, opts) {
    const o = opts || {};
    const list = (Array.isArray(chats) ? chats : []).filter((c) => c && c.id);
    const kind = normalizeKindOrNull(o.kind);
    const filtered = list.filter((c) => {
      if (kind && normalizeKindOrNull(c.kind) !== kind) return false;
      if (o.onlyVisible && !isVisibleByDefault(c)) return false;
      return matches(c, query);
    });
    const limit = Number(o.limit) > 0 ? Number(o.limit) : 0;
    return limit ? filtered.slice(0, limit) : filtered;
  }

  // ── Quando pretendere tutte le parole significa non trovare niente ────────
  //
  // «Riprendi la discussione di ieri sulla coscienza» è il modo in cui il
  // feedback stesso descrive la richiesta, ed è la frase che arriva qui dentro
  // quando Filo cerca con le parole dell'utente. Pretendendo che compaiano
  // TUTTE, quella frase non trova la chat sulla coscienza: bastano «di ieri» o
  // «discussione» a farla sparire, e Filo risponde che quella discussione non
  // esiste. Vale anche per chi scrive una frase nel campo di ricerca di
  // Cronologia.
  //
  // Queste sono le parole che non distinguono una chat dall'altra: articoli,
  // preposizioni, i modi di dire «quella volta che ne abbiamo parlato». Non si
  // buttano mai a priori: si tolgono solo quando pretenderle tutte non ha
  // trovato niente, e chi chiama SA che la ricerca si è allargata (lo dice a
  // chi guarda, invece di far finta che la richiesta fosse quella).
  const PAROLE_CHE_NON_DISTINGUONO = new Set([
    'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra', 'il', 'lo', 'la', 'i', 'gli', 'le',
    'un', 'uno', 'una', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'al', 'allo', 'alla',
    'ai', 'agli', 'alle', 'dal', 'dalla', 'nel', 'nella', 'sul', 'sulla', 'sullo', 'sui', 'sulle',
    'che', 'chi', 'cosa', 'come', 'quando', 'dove', 'perche', 'non', 'piu', 'mi', 'ti', 'si',
    'ci', 'vi', 'ne', 'e', 'ed', 'o', 'ma', 'se', 'ho', 'hai', 'ha', 'era', 'erano', 'sono',
    'ieri', 'oggi', 'altro', 'altra', 'volta', 'quella', 'quello', 'questa', 'questo', 'mio',
    'mia', 'tuo', 'tua', 'chat', 'discussione', 'discussioni', 'conversazione', 'conversazioni',
    'parlato', 'parlare', 'parlavamo', 'detto', 'dire', 'riprendi', 'riprendere', 'ricordi',
    'avevamo', 'avevo', 'avevi', 'scorsa', 'scorso', 'settimana', 'fa',
  ]);

  // Le parole della richiesta che davvero restringono il campo: le altre le
  // scrive chiunque, in qualunque chat.
  function terminiCheDistinguono(terms) {
    return (Array.isArray(terms) ? terms : [])
      .filter((t) => t.length > 3 && !PAROLE_CHE_NON_DISTINGUONO.has(t));
  }

  function filtraPerTipo(chats, o) {
    const kind = normalizeKindOrNull(o.kind);
    return (Array.isArray(chats) ? chats : []).filter((c) => {
      if (!c || !c.id) return false;
      if (kind && normalizeKindOrNull(c.kind) !== kind) return false;
      if (o.onlyVisible && !isVisibleByDefault(c)) return false;
      return true;
    });
  }

  // Ritorna { results, termini, allargata }:
  //  • `results` le chat trovate;
  //  • `termini` le parole con cui sono state trovate davvero;
  //  • `allargata` vero se pretendere tutte le parole non aveva trovato niente.
  //
  // Tre passi, dal più stretto al più largo, e ci si ferma al primo che trova
  // qualcosa: tutte le parole; poi le sole parole che distinguono; poi almeno
  // una di quelle, con in testa le chat che ne contengono di più.
  function searchWide(chats, query, opts) {
    const o = opts || {};
    const limit = Number(o.limit) > 0 ? Number(o.limit) : 0;
    const taglia = (list) => (limit ? list.slice(0, limit) : list);
    const candidate = filtraPerTipo(chats, o);
    const tutte = normalizeForSearch(query).split(/\s+/).filter(Boolean);
    if (!tutte.length) return { results: taglia(candidate), termini: [], allargata: false };

    const hays = new Map(candidate.map((c) => [c.id, haystackOf(c)]));
    const conTutte = candidate.filter((c) => tutte.every((t) => hays.get(c.id).includes(t)));
    if (conTutte.length) return { results: taglia(conTutte), termini: tutte, allargata: false };

    const forti = terminiCheDistinguono(tutte);
    // Nessuna parola restringe il campo (l'utente ha cercato «di ieri»):
    // allargare vorrebbe dire tirare fuori mezzo archivio spacciandolo per una
    // risposta. Meglio dire che non si è trovato niente.
    if (!forti.length) return { results: [], termini: tutte, allargata: false };

    if (forti.length < tutte.length) {
      const conForti = candidate.filter((c) => forti.every((t) => hays.get(c.id).includes(t)));
      if (conForti.length) return { results: taglia(conForti), termini: forti, allargata: true };
    }

    // Ultimo passo: almeno una parola che distingue. Ordinate per quante ne
    // combaciano, così la chat più pertinente resta in cima.
    const punteggi = candidate
      .map((c) => ({ c, n: forti.filter((t) => hays.get(c.id).includes(t)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    if (!punteggi.length) return { results: [], termini: forti, allargata: true };
    return { results: taglia(punteggi.map((x) => x.c)), termini: forti, allargata: true };
  }

  // Un frammento della chat attorno alla prima occorrenza della ricerca: è
  // quello che fa capire PERCHÉ una chat è nel risultato. Senza, un elenco di
  // titoli obbliga ad aprirle una per una.
  function snippetFor(chat, query, radius) {
    const r = Number(radius) > 0 ? Number(radius) : 90;
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : [];
    const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return excerptOf(messages);
    // La parola da mostrare è la prima della richiesta che COMPARE davvero, non
    // la prima scritta: cercando «la coscienza», un frammento costruito attorno
    // a «la» non dice niente a chi legge l'elenco.
    for (const m of messages) {
      const text = String((m && m.text) || '');
      if (!text.trim()) continue;
      const hay = normalizeForSearch(text);
      let termine = '';
      let at = -1;
      for (const t of terms) {
        const i = hay.indexOf(t);
        if (i >= 0 && (at < 0 || t.length > termine.length)) { at = i; termine = t; }
      }
      if (at < 0) continue;
      const from = Math.max(0, at - r);
      const to = Math.min(text.length, at + termine.length + r);
      const body = text.slice(from, to).replace(/\s+/g, ' ').trim();
      return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`;
    }
    return excerptOf(messages);
  }

  // ── Turni → messaggi da salvare ──────────────────────────────────────────
  // Una voce dello storico del thread della dashboard, ridotta a quello che ha
  // senso rileggere. Le immagini incollate NON entrano: sono data URL da
  // centinaia di KB l'una, e l'archivio deve restare leggibile per anni.
  // Restano il testo e le azioni (è quello che Filo ha fatto, e rileggendo la
  // chat si deve capire).
  function toStoredMessage(turn) {
    if (!turn) return null;
    const role = turn.role === 'user' ? 'user' : 'filo';
    const text = String(turn.text == null ? '' : turn.text);
    const out = { role, text, ts: turn.ts || new Date().toISOString() };
    // Di un'azione si tiene anche COM'È ANDATA, o la conversazione riaperta
    // racconta come riuscito tutto quello che Filo ha soltanto nominato.
    // `id` è la targa con cui il click che arriva dopo ritrova la sua azione.
    if (Array.isArray(turn.actions) && turn.actions.length) {
      const E = (typeof globalThis !== 'undefined' && globalThis.SN_ESITO) || null;
      out.actions = turn.actions
        .filter((a) => a && a.type)
        .map((a) => {
          const v = { type: String(a.type), esito: E ? E.esitoAzione(a) : 'fatto' };
          if (a._callId) v.id = String(a._callId);
          return v;
        });
    }
    if (turn.images) out.images = Number(turn.images) || 0;
    return out;
  }

  // ── L'esito di un comando di terminale ───────────────────────────────────
  // Anche questo è una battuta della conversazione: l'utente l'ha letto a
  // schermo, e rileggendo la chat deve ritrovarlo. Può però essere enorme (un
  // `cat` su un file grosso), e l'archivio resta su disco per anni. Si tiene
  // l'inizio e la fine, e si DICE quanto manca: un taglio muto sull'esito di un
  // comando toglie proprio la riga di errore in fondo.
  const OUTPUT_MAX = 20000;
  function clampOutput(text, maxChars) {
    const cap = Number(maxChars) > 0 ? Number(maxChars) : OUTPUT_MAX;
    const s = String(text == null ? '' : text);
    if (s.length <= cap) return s;
    const testa = s.slice(0, Math.floor(cap * 0.6));
    const coda = s.slice(-Math.floor(cap * 0.4));
    const tolti = s.length - testa.length - coda.length;
    return `${testa}\n…(${tolti} caratteri dell'esito non conservati)…\n${coda}`;
  }

  global.SN_CHAT_ARCHIVE = {
    KIND_TALK,
    KIND_COMMAND,
    KINDS,
    TITLE_MAX,
    OUTPUT_MAX,
    clampTitle,
    clampOutput,
    fallbackTitle,
    normalizeKind,
    normalizeKindOrNull,
    parseTriage,
    transcriptForTriage,
    toIndexEntry,
    excerptOf,
    isVisibleByDefault,
    normalizeForSearch,
    matches,
    search,
    searchWide,
    terminiCheDistinguono,
    snippetFor,
    toStoredMessage,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
