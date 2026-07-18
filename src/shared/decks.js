// Modello dati dei mazzi Commander (deck builder, DECK-BUILDER-SPEC.md §13.1).
// SOLO logica pura (creazione, patch, invarianti): niente storage, niente
// Electron — la persistenza vive in src/main/services/deckStore.js. Così il
// modello è unit-testabile in millisecondi (tests/unit/decks.test.mjs).
//
// Invariante centrale: `versione` incrementa a OGNI modifica del mazzo — è la
// chiave di invalidazione dei pareri LLM (§6.2): parere cacheato per
// (carta, versione mazzo), marcato stantio quando la versione avanza.

(function (global) {
  'use strict';

  const RAGGRUPPAMENTI = ['tipo', 'tag', 'cmc', 'colore'];

  // Nomi segnaposto che l'app assegna a un mazzo senza nome scelto dall'utente.
  // Un mazzo con uno di questi nomi (o marcato `nomeAuto`) può essere
  // ri-nominato automaticamente dal commander senza calpestare una scelta reale.
  const NOME_DEFAULT = 'Nuovo mazzo';
  const NOMI_SEGNAPOSTO = [NOME_DEFAULT, 'Mazzo senza nome'];

  function isNomeSegnaposto(nome) {
    return NOMI_SEGNAPOSTO.includes(String(nome || '').trim());
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function nowIso() { return new Date().toISOString(); }

  // Nuovo mazzo vuoto. Il commander è un PARAMETRO del mazzo (§8.4), non una
  // carta dell'elenco: qui è lo scryfall_id (vuoto finché non impostato).
  // `commanderMeta` è la cache di presentazione (nome, colori identity, art
  // crop) scritta quando il commander viene impostato/risolto via Scryfall
  // (task 2): la libreria la usa senza rifare lookup a ogni render.
  function newDeck({ nome } = {}) {
    const t = nowIso();
    const nomeScelto = String(nome || '').trim();
    return {
      id: uuid(),
      nome: nomeScelto || NOME_DEFAULT,
      // `nomeAuto` = il nome è segnaposto/derivato, non scelto dall'utente:
      // quando true, impostare un commander rinomina il mazzo col suo nome.
      // Una rinomina manuale lo azzera (mai calpestare una scelta esplicita).
      nomeAuto: !nomeScelto,
      commander: '',
      commanderMeta: null,
      carte: [],
      raggruppamento: 'tipo',
      budget: null,
      versione: 1,
      created_at: t,
      updated_at: t,
    };
  }

  // Riporta un oggetto letto dallo storage a un mazzo valido (campi mancanti
  // riempiti, tipi corretti). Ritorna null se non è recuperabile (manca l'id).
  function sanitizeDeck(raw) {
    if (!raw || typeof raw !== 'object' || !raw.id) return null;
    const carte = Array.isArray(raw.carte) ? raw.carte : [];
    const nome = String(raw.nome || '').trim() || 'Mazzo senza nome';
    return {
      id: String(raw.id),
      nome,
      // Mazzi salvati prima di questa feature non hanno il flag: lo deduciamo
      // dal nome (un segnaposto è auto-nominabile; un nome vero è dell'utente).
      nomeAuto: typeof raw.nomeAuto === 'boolean' ? raw.nomeAuto : isNomeSegnaposto(nome),
      commander: String(raw.commander || ''),
      commanderMeta: (raw.commanderMeta && typeof raw.commanderMeta === 'object') ? raw.commanderMeta : null,
      carte: carte
        .filter((c) => c && c.scryfall_id)
        .map((c) => ({
          scryfall_id: String(c.scryfall_id),
          qty: Math.max(1, Number(c.qty) || 1),
          tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
          ...(c.gruppo_override ? { gruppo_override: String(c.gruppo_override) } : {}),
        })),
      raggruppamento: RAGGRUPPAMENTI.includes(raw.raggruppamento) ? raw.raggruppamento : 'tipo',
      budget: (raw.budget === null || raw.budget === undefined || raw.budget === '') ? null : Math.max(0, Number(raw.budget) || 0),
      versione: Math.max(1, Number(raw.versione) || 1),
      created_at: raw.created_at || nowIso(),
      updated_at: raw.updated_at || nowIso(),
    };
  }

  // Ogni edit passa da qui: nuova copia con versione+1 e updated_at fresco.
  function touch(deck) {
    return { ...deck, versione: (Number(deck.versione) || 1) + 1, updated_at: nowIso() };
  }

  // Aggiunge una carta (default qty 1 — singleton salvo basics, che il chiamante
  // segnala con qty espliciti). Se la carta è già presente NON duplica: ritorna
  // { deck, added:false } col mazzo invariato (versione ferma: nessun edit reale).
  function addCard(deck, scryfallId, { qty = 1, tags = [] } = {}) {
    const id = String(scryfallId || '').trim();
    if (!id) return { deck, added: false };
    if (deck.carte.some((c) => c.scryfall_id === id)) return { deck, added: false };
    const next = touch({
      ...deck,
      carte: [...deck.carte, { scryfall_id: id, qty: Math.max(1, Number(qty) || 1), tags: tags.map(String) }],
    });
    return { deck: next, added: true };
  }

  // Copia/sposta VERSO un altro mazzo: se la carta manca si aggiunge (come
  // addCard), se c'è già le quantità si SOMMANO e i tag si uniscono — mai un
  // no-op silenzioso che farebbe sparire copie (il chiamante "move" rimuove
  // dall'origine solo dopo che questo merge è stato salvato con successo).
  // Ritorna { deck, added:true } se la carta era nuova, { deck, merged:true }
  // se le copie sono state sommate a quelle esistenti.
  function mergeCard(deck, scryfallId, { qty = 1, tags = [] } = {}) {
    const id = String(scryfallId || '').trim();
    if (!id) return { deck, added: false, merged: false };
    const existing = deck.carte.find((c) => c.scryfall_id === id);
    if (!existing) {
      const { deck: next, added } = addCard(deck, id, { qty, tags });
      return { deck: next, added, merged: false };
    }
    const addQty = Math.max(1, Number(qty) || 1);
    const mergedTags = [...existing.tags];
    for (const t of (tags || []).map(String)) {
      if (!mergedTags.includes(t)) mergedTags.push(t);
    }
    const carte = deck.carte.map((c) => (c === existing
      ? { ...c, qty: c.qty + addQty, tags: mergedTags }
      : c));
    return { deck: touch({ ...deck, carte }), added: false, merged: true };
  }

  function removeCard(deck, scryfallId) {
    const id = String(scryfallId || '').trim();
    const carte = deck.carte.filter((c) => c.scryfall_id !== id);
    if (carte.length === deck.carte.length) return { deck, removed: false };
    return { deck: touch({ ...deck, carte }), removed: true };
  }

  // Import bulk (§11): merge di entries [{scryfall_id, qty}] nel mazzo. Le
  // carte già presenti aggiornano la qty (utile per re-importare lo stesso
  // mazzo dopo una modifica esterna, i tag esistenti restano); le nuove si
  // aggiungono con tags:[]. UN solo touch se c'è almeno una modifica reale.
  function importCards(deck, entries) {
    const list = Array.isArray(entries) ? entries : [];
    const byId = new Map(deck.carte.map((c) => [c.scryfall_id, c]));
    let addedCount = 0;
    let updatedCount = 0;
    for (const e of list) {
      const id = String((e && e.scryfall_id) || '').trim();
      if (!id) continue;
      const qty = Math.max(1, Number(e.qty) || 1);
      const existing = byId.get(id);
      if (existing) {
        if (existing.qty !== qty) { byId.set(id, { ...existing, qty }); updatedCount++; }
      } else {
        byId.set(id, { scryfall_id: id, qty, tags: [] });
        addedCount++;
      }
    }
    if (!addedCount && !updatedCount) return { deck, addedCount: 0, updatedCount: 0 };
    return { deck: touch({ ...deck, carte: [...byId.values()] }), addedCount, updatedCount };
  }

  // Rinomina esplicita dell'utente: fissa il nome e marca `nomeAuto:false`, così
  // un commander impostato/cambiato in seguito NON lo sovrascrive più.
  function renameDeck(deck, nome) {
    const n = String(nome || '').trim();
    if (!n || (n === deck.nome && deck.nomeAuto === false)) return deck;
    return touch({ ...deck, nome: n, nomeAuto: false });
  }

  // Imposta il commander. Se il mazzo ha ancora un nome automatico/segnaposto e
  // il commander ha un nome, il mazzo prende quel nome (resta `nomeAuto:true`,
  // così segue anche un eventuale cambio di commander). Un nome scelto a mano
  // dall'utente non viene mai toccato.
  function setCommander(deck, scryfallId, meta = null) {
    const id = String(scryfallId || '').trim();
    const m = meta || null;
    const next = { ...deck, commander: id, commanderMeta: m };
    const autoName = deck.nomeAuto && id && m && String(m.name || '').trim();
    if (autoName) { next.nome = String(m.name).trim(); next.nomeAuto = true; }
    return touch(next);
  }

  // Parsa il testo del campo budget come lo scrive l'utente. L'app mostra
  // TUTTI i prezzi in formato italiano («12,50 €»), quindi il tetto scritto
  // con la virgola decimale è l'input più naturale: qui la virgola è un
  // separatore decimale valido, insieme al punto. Tollerati anche il simbolo
  // €, gli spazi e il separatore delle migliaia («1.234,56» / «1,234.56»).
  // Ritorna { ok:true, value:<number|null> } (null = nessun tetto) oppure
  // { ok:false } se il testo NON è un numero: in quel caso il chiamante non
  // deve salvare nulla (mai stravolgere o cancellare il tetto in silenzio).
  function parseBudgetInput(text) {
    if (text === null || text === undefined) return { ok: true, value: null };
    let s = String(text).replace(/€/g, '').replace(/\s+/g, '');
    if (s === '') return { ok: true, value: null };
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot !== -1 && lastComma !== -1) {
      // Entrambi i separatori: il più a destra è quello decimale, l'altro è
      // il separatore delle migliaia («1.234,56» oppure «1,234.56»).
      const dec = lastDot > lastComma ? '.' : ',';
      const thou = dec === '.' ? ',' : '.';
      s = s.split(thou).join('');
      if (dec === ',') s = s.replace(',', '.');
    } else if (lastComma !== -1) {
      // Solo virgole: una sola è il decimale italiano; più d'una non è un numero.
      if (s.indexOf(',') !== lastComma) return { ok: false };
      s = s.replace(',', '.');
    }
    if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false };
    const n = Number(s);
    if (!Number.isFinite(n)) return { ok: false };
    return { ok: true, value: n };
  }

  function setBudget(deck, budget) {
    let b;
    if (typeof budget === 'string') {
      // Difesa in profondità: se arriva la stringa grezza dell'input, passa
      // dal parser (virgola inclusa); testo non numerico → mazzo INVARIATO,
      // mai un Number()||0 che azzererebbe il tetto in silenzio.
      const p = parseBudgetInput(budget);
      if (!p.ok) return deck;
      b = p.value;
    } else {
      b = (budget === null || budget === undefined) ? null : Math.max(0, Number(budget) || 0);
    }
    return touch({ ...deck, budget: b });
  }

  // Totale carte del mazzo (somma qty): il conteggio /100 della libreria e
  // delle statistiche.
  function deckCount(deck) {
    return deck.carte.reduce((n, c) => n + (Number(c.qty) || 1), 0);
  }

  // Copia per "duplica": nuovo id, nome " (copia)", versione ripartita da 1
  // (i pareri cacheati del mazzo origine non valgono per la copia).
  function duplicateDeck(deck) {
    const t = nowIso();
    return {
      ...deck,
      id: uuid(),
      nome: `${deck.nome} (copia)`,
      // La copia ha un nome derivato deliberato: non farlo inseguire da un
      // eventuale cambio di commander sulla copia.
      nomeAuto: false,
      carte: deck.carte.map((c) => ({ ...c, tags: [...c.tags] })),
      versione: 1,
      created_at: t,
      updated_at: t,
    };
  }

  // Ordine della libreria: ultima modifica in cima.
  function sortForLibrary(decks) {
    return [...decks].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  // ── Raggruppamento della colonna mazzo (§8.1) ──────────────────────────────
  // Il raggruppamento è una FUNZIONE DI VISUALIZZAZIONE: il mazzo resta una
  // lista piatta, i gruppi si calcolano al volo da (deck, dati carta).

  const TIPO_ORDINE = ['Comandante', 'Creature', 'Istantanei', 'Stregonerie', 'Artefatti', 'Incantesimi', 'Planeswalker', 'Battaglie', 'Terre', 'Altro'];
  const COLORE_ORDINE = ['Bianco', 'Blu', 'Nero', 'Rosso', 'Verde', 'Multicolore', 'Incolore'];
  const COLORE_NOME = { W: 'Bianco', U: 'Blu', B: 'Nero', R: 'Rosso', G: 'Verde' };

  function tipoOf(card) {
    const t = String((card && card.typeLine) || '');
    // La parte davanti al "—" e PRIMA dello slash delle bifronte.
    const front = t.split('//')[0];
    if (/\bLand\b/i.test(front)) return 'Terre';
    if (/\bCreature\b/i.test(front)) return 'Creature';
    if (/\bPlaneswalker\b/i.test(front)) return 'Planeswalker';
    if (/\bBattle\b/i.test(front)) return 'Battaglie';
    if (/\bInstant\b/i.test(front)) return 'Istantanei';
    if (/\bSorcery\b/i.test(front)) return 'Stregonerie';
    if (/\bArtifact\b/i.test(front)) return 'Artefatti';
    if (/\bEnchantment\b/i.test(front)) return 'Incantesimi';
    return 'Altro';
  }

  function coloreOf(card) {
    const c = (card && (card.colors && card.colors.length ? card.colors : card.colorIdentity)) || [];
    if (!c.length) return 'Incolore';
    if (c.length > 1) return 'Multicolore';
    return COLORE_NOME[c[0]] || 'Incolore';
  }

  function cmcBucket(card) {
    const n = Math.floor(Number(card && card.cmc) || 0);
    return n >= 7 ? '7+' : String(n);
  }

  // Gruppo di UNA entry secondo la vista corrente. `tagOrder` = ordine dei
  // gruppi-tag definito (per la regola "primo gruppo che matcha", §8.1).
  // L'override esplicito dell'utente (tasto destro → sposta in gruppo) vince.
  function groupOf(entry, card, raggruppamento, tagOrder = []) {
    if (entry && entry.gruppo_override) return entry.gruppo_override;
    if (raggruppamento === 'tag') {
      const tags = (entry && entry.tags) || [];
      for (const t of tagOrder) if (tags.includes(t)) return t;
      return 'Senza tag';
    }
    if (raggruppamento === 'cmc') return cmcBucket(card);
    if (raggruppamento === 'colore') return coloreOf(card);
    return tipoOf(card);
  }

  // Ordine dei gruppi-tag: prima apparizione nel mazzo (stabile e prevedibile).
  function tagOrderOf(deck) {
    const seen = [];
    for (const c of deck.carte) {
      for (const t of c.tags || []) if (!seen.includes(t)) seen.push(t);
    }
    return seen;
  }

  // Vista a gruppi: [{ name, entries: [{ entry, card }] }]. Ogni carta appare
  // UNA sola volta (il gruppo lo decide groupOf); dentro il gruppo ordina per
  // CMC crescente, poi nome. I gruppi seguono l'ordine canonico della vista;
  // i gruppi extra (override/tag ignoti) in coda, in ordine alfabetico.
  function groupDeck(deck, cardsById) {
    const view = deck.raggruppamento || 'tipo';
    const tagOrder = view === 'tag' ? tagOrderOf(deck) : [];
    const buckets = new Map();
    for (const entry of deck.carte) {
      const card = cardsById[entry.scryfall_id] || null;
      const g = groupOf(entry, card, view, tagOrder);
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push({ entry, card });
    }
    for (const arr of buckets.values()) {
      arr.sort((a, b) => {
        const ca = Number(a.card && a.card.cmc) || 0;
        const cb = Number(b.card && b.card.cmc) || 0;
        if (ca !== cb) return ca - cb;
        return String(a.card && a.card.name || '').localeCompare(String(b.card && b.card.name || ''));
      });
    }
    const canon = view === 'tipo' ? TIPO_ORDINE
      : view === 'colore' ? COLORE_ORDINE
      : view === 'cmc' ? ['0', '1', '2', '3', '4', '5', '6', '7+']
      : [...tagOrder, 'Senza tag'];
    const names = [...buckets.keys()].sort((a, b) => {
      const ia = canon.indexOf(a); const ib = canon.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    return names.map((name) => ({ name, entries: buckets.get(name) }));
  }

  // ── Legalità Commander (§8.4): il commander è un parametro del mazzo ───────
  // Check PURI su (deck, dati carta): singleton (basics escluse), color
  // identity per carta rispetto al commander, banned list. `violations` sono
  // nomi carta, pronti da mostrare.
  function legalityChecks(deck, cardsById) {
    const nameOf = (id) => (cardsById[id] && cardsById[id].name) || id;
    const isBasic = (id) => /\bBasic\b.*\bLand\b/i.test(String(cardsById[id] && cardsById[id].typeLine || ''));

    const seen = new Set();
    const singletonViolations = [];
    for (const c of deck.carte) {
      if (isBasic(c.scryfall_id)) continue;
      if (c.qty > 1 || seen.has(c.scryfall_id)) singletonViolations.push(nameOf(c.scryfall_id));
      seen.add(c.scryfall_id);
    }

    const identityViolations = [];
    const commanderColors = deck.commanderMeta && Array.isArray(deck.commanderMeta.colors)
      ? deck.commanderMeta.colors : null;
    if (commanderColors) {
      const allowed = new Set(commanderColors);
      for (const c of deck.carte) {
        const card = cardsById[c.scryfall_id];
        if (!card) continue;
        if ((card.colorIdentity || []).some((col) => !allowed.has(col))) {
          identityViolations.push(card.name);
        }
      }
    }

    const bannedViolations = [];
    for (const c of deck.carte) {
      const card = cardsById[c.scryfall_id];
      if (card && card.legalCommander === false) bannedViolations.push(card.name);
    }

    return {
      count: deckCount(deck) + (deck.commander ? 1 : 0),
      singleton: { ok: !singletonViolations.length, violations: singletonViolations },
      identity: { ok: !identityViolations.length, violations: identityViolations },
      banned: { ok: !bannedViolations.length, violations: bannedViolations },
    };
  }

  // Override di gruppo (tasto destro → "sposta in gruppo", §8.1). Gruppo
  // vuoto/null rimuove l'override (si torna al raggruppamento naturale).
  function setGroupOverride(deck, scryfallId, gruppo) {
    const id = String(scryfallId || '');
    let changed = false;
    const carte = deck.carte.map((c) => {
      if (c.scryfall_id !== id) return c;
      changed = true;
      const next = { ...c, tags: [...c.tags] };
      if (gruppo) next.gruppo_override = String(gruppo);
      else delete next.gruppo_override;
      return next;
    });
    return changed ? touch({ ...deck, carte }) : deck;
  }

  function setRaggruppamento(deck, view) {
    if (!RAGGRUPPAMENTI.includes(view) || view === deck.raggruppamento) return deck;
    return touch({ ...deck, raggruppamento: view });
  }

  global.SN_DECKS = {
    RAGGRUPPAMENTI,
    TIPO_ORDINE,
    newDeck,
    sanitizeDeck,
    touch,
    addCard,
    mergeCard,
    removeCard,
    importCards,
    renameDeck,
    setCommander,
    parseBudgetInput,
    setBudget,
    deckCount,
    duplicateDeck,
    sortForLibrary,
    tipoOf,
    coloreOf,
    cmcBucket,
    groupOf,
    tagOrderOf,
    groupDeck,
    legalityChecks,
    setGroupOverride,
    setRaggruppamento,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
