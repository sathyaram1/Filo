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
    return {
      id: uuid(),
      nome: String(nome || '').trim() || 'Nuovo mazzo',
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
    return {
      id: String(raw.id),
      nome: String(raw.nome || '').trim() || 'Mazzo senza nome',
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

  function removeCard(deck, scryfallId) {
    const id = String(scryfallId || '').trim();
    const carte = deck.carte.filter((c) => c.scryfall_id !== id);
    if (carte.length === deck.carte.length) return { deck, removed: false };
    return { deck: touch({ ...deck, carte }), removed: true };
  }

  function renameDeck(deck, nome) {
    const n = String(nome || '').trim();
    if (!n || n === deck.nome) return deck;
    return touch({ ...deck, nome: n });
  }

  function setCommander(deck, scryfallId, meta = null) {
    const id = String(scryfallId || '').trim();
    return touch({ ...deck, commander: id, commanderMeta: meta || null });
  }

  function setBudget(deck, budget) {
    const b = (budget === null || budget === undefined || budget === '') ? null : Math.max(0, Number(budget) || 0);
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

  const WUBRG = ['W', 'U', 'B', 'R', 'G'];
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
    removeCard,
    renameDeck,
    setCommander,
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
