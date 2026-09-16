// Modello dati dei mazzi Commander (DECK-BUILDER-SPEC.md §13.1), solo logica pura; la persistenza vive in src/main/services/deckStore.js.
// Invariante centrale: `versione` incrementa a OGNI modifica, ed è la chiave di invalidazione dei pareri LLM (§6.2), cacheati per (carta, versione mazzo).

(function (global) {
  'use strict';

  const RAGGRUPPAMENTI = ['tipo', 'tag', 'cmc', 'colore'];

  // Nomi segnaposto dell'app: un mazzo che ne porta uno (o è marcato `nomeAuto`) può essere rinominato dal commander senza calpestare una scelta reale dell'utente.
  const NOME_DEFAULT = 'Nuovo mazzo';
  const NOMI_SEGNAPOSTO = [NOME_DEFAULT, 'Mazzo senza nome'];

  function isNomeSegnaposto(nome) {
    return NOMI_SEGNAPOSTO.includes(String(nome || '').trim());
  }

  // L'override di gruppo è PER-VISTA — mappa { raggruppamento: gruppo } — così uno spostamento fatto «per tipo» vale solo lì (#316).
  // Il vecchio formato a stringa unica va alla vista corrente del mazzo: la carta resta dove l'utente la vede aprendo il mazzo e smette di seguire le altre viste.
  function normalizeOverride(raw, defaultView) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      const g = raw.trim();
      return g ? { [defaultView]: g } : null;
    }
    if (typeof raw === 'object') {
      const out = {};
      for (const v of RAGGRUPPAMENTI) {
        const g = raw[v];
        if (g && String(g).trim()) out[v] = String(g).trim();
      }
      return Object.keys(out).length ? out : null;
    }
    return null;
  }

  // Immutabile: ritorna la nuova mappa, o undefined se resta vuota, così il campo sparisce dall'entry.
  function overrideWithoutView(ov, view) {
    if (!ov || typeof ov !== 'object') return undefined;
    if (!(view in ov)) return ov;
    const next = { ...ov };
    delete next[view];
    return Object.keys(next).length ? next : undefined;
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function nowIso() { return new Date().toISOString(); }

  // Il commander è un PARAMETRO del mazzo (§8.4), non una carta dell'elenco. `commanderMeta` è la cache di presentazione scritta quando viene impostato o risolto, così la libreria non rifà un lookup a ogni render.
  function newDeck({ nome } = {}) {
    const t = nowIso();
    const nomeScelto = String(nome || '').trim();
    return {
      id: uuid(),
      nome: nomeScelto || NOME_DEFAULT,
      // `nomeAuto` = il nome è segnaposto o derivato, non scelto dall'utente: finché è true, impostare un commander rinomina il mazzo. Una rinomina manuale lo azzera, perché una scelta esplicita non si calpesta.
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

  // Riporta un oggetto letto dallo storage a un mazzo valido. Null se manca l'id, cioè se non è recuperabile.
  function sanitizeDeck(raw) {
    if (!raw || typeof raw !== 'object' || !raw.id) return null;
    const carte = Array.isArray(raw.carte) ? raw.carte : [];
    const nome = String(raw.nome || '').trim() || 'Mazzo senza nome';
    const view = RAGGRUPPAMENTI.includes(raw.raggruppamento) ? raw.raggruppamento : 'tipo';
    return {
      id: String(raw.id),
      nome,
      // I mazzi salvati prima del flag non ce l'hanno: lo si deduce dal nome, perché un segnaposto è auto-nominabile e un nome vero è dell'utente.
      nomeAuto: typeof raw.nomeAuto === 'boolean' ? raw.nomeAuto : isNomeSegnaposto(nome),
      commander: String(raw.commander || ''),
      commanderMeta: (raw.commanderMeta && typeof raw.commanderMeta === 'object') ? raw.commanderMeta : null,
      carte: carte
        .filter((c) => c && c.scryfall_id)
        .map((c) => {
          const ov = normalizeOverride(c.gruppo_override, view);
          return {
            scryfall_id: String(c.scryfall_id),
            qty: Math.max(1, Number(c.qty) || 1),
            tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
            ...(ov ? { gruppo_override: ov } : {}),
          };
        }),
      raggruppamento: view,
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

  // Se la carta c'è già NON si duplica: { deck, added:false } col mazzo invariato e la versione ferma, perché non c'è stato nessun edit reale.
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

  // Copia o sposta VERSO un altro mazzo: se manca si aggiunge, se c'è le quantità si SOMMANO e i tag si uniscono — mai un no-op silenzioso che farebbe sparire copie (chi «sposta» rimuove dall'origine solo dopo che il merge è salvato).
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

  // Import bulk (§11): le carte già presenti aggiornano la qty e tengono i loro tag, utile per reimportare lo stesso mazzo dopo una modifica esterna; le nuove entrano con tags vuoti. UN solo touch se c'è almeno una modifica reale.
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

  // Rinomina esplicita: fissa il nome e marca `nomeAuto:false`, così un commander cambiato in seguito non lo sovrascrive più.
  function renameDeck(deck, nome) {
    const n = String(nome || '').trim();
    if (!n || (n === deck.nome && deck.nomeAuto === false)) return deck;
    return touch({ ...deck, nome: n, nomeAuto: false });
  }

  // Se il mazzo ha ancora un nome automatico prende quello del commander, restando `nomeAuto:true` per seguire anche un cambio di commander. Un nome scelto a mano non si tocca mai.
  function setCommander(deck, scryfallId, meta = null) {
    const id = String(scryfallId || '').trim();
    const m = meta || null;
    const next = { ...deck, commander: id, commanderMeta: m };
    const autoName = deck.nomeAuto && id && m && String(m.name || '').trim();
    if (autoName) { next.nome = String(m.name).trim(); next.nomeAuto = true; }
    return touch(next);
  }

  // L'app mostra i prezzi in formato italiano, quindi il tetto con la virgola decimale è l'input naturale: virgola e punto valgono uguale, e si tollerano €, spazi e separatore delle migliaia.
  // { ok:false } se il testo non è un numero: il chiamante non salva niente, perché il tetto non si stravolge né si cancella in silenzio.
  function parseBudgetInput(text) {
    if (text === null || text === undefined) return { ok: true, value: null };
    let s = String(text).replace(/€/g, '').replace(/\s+/g, '');
    if (s === '') return { ok: true, value: null };
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot !== -1 && lastComma !== -1) {
      // Con entrambi i separatori, il più a destra è il decimale e l'altro le migliaia.
      const dec = lastDot > lastComma ? '.' : ',';
      const thou = dec === '.' ? ',' : '.';
      s = s.split(thou).join('');
      if (dec === ',') s = s.replace(',', '.');
    } else if (lastComma !== -1) {
      // Solo virgole: una sola è il decimale italiano, più d'una non è un numero.
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
      // Difesa in profondità: se arriva la stringa grezza dell'input passa dal parser. Testo non numerico → mazzo INVARIATO, mai un Number()||0 che azzererebbe il tetto in silenzio.
      const p = parseBudgetInput(budget);
      if (!p.ok) return deck;
      b = p.value;
    } else {
      b = (budget === null || budget === undefined) ? null : Math.max(0, Number(budget) || 0);
    }
    return touch({ ...deck, budget: b });
  }

  // Somma delle qty: è il conteggio /100 della libreria e delle statistiche.
  function deckCount(deck) {
    return deck.carte.reduce((n, c) => n + (Number(c.qty) || 1), 0);
  }

  // Copia per «duplica»: nuovo id e versione da 1, perché i pareri cacheati del mazzo di origine non valgono per la copia.
  function duplicateDeck(deck) {
    const t = nowIso();
    return {
      ...deck,
      id: uuid(),
      nome: `${deck.nome} (copia)`,
      // Il nome derivato della copia è deliberato: non deve inseguire un eventuale cambio di commander sulla copia.
      nomeAuto: false,
      carte: deck.carte.map((c) => ({ ...c, tags: [...c.tags] })),
      versione: 1,
      created_at: t,
      updated_at: t,
    };
  }

  // Ultima modifica in cima.
  function sortForLibrary(decks) {
    return [...decks].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  // Il raggruppamento è una FUNZIONE DI VISUALIZZAZIONE (§8.1): il mazzo resta una lista piatta e i gruppi si calcolano al volo da (deck, dati carta).

  const TIPO_ORDINE = ['Comandante', 'Creature', 'Istantanei', 'Stregonerie', 'Artefatti', 'Incantesimi', 'Planeswalker', 'Battaglie', 'Terre', 'Altro'];
  const COLORE_ORDINE = ['Bianco', 'Blu', 'Nero', 'Rosso', 'Verde', 'Multicolore', 'Incolore'];
  const COLORE_NOME = { W: 'Bianco', U: 'Blu', B: 'Nero', R: 'Rosso', G: 'Verde' };

  function tipoOf(card) {
    const t = String((card && card.typeLine) || '');
    // La parte davanti al «—» e PRIMA dello slash delle bifronte.
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

  // `tagOrder` è l'ordine dei gruppi-tag, per la regola «primo gruppo che matcha» (§8.1). L'override dell'utente vince, ma SOLO nella vista in cui è stato fatto: è una mappa per-vista (#316), non un valore che seguirebbe la carta ovunque.
  function groupOf(entry, card, raggruppamento, tagOrder = []) {
    const ov = entry && entry.gruppo_override;
    if (ov && typeof ov === 'object' && ov[raggruppamento]) return ov[raggruppamento];
    if (raggruppamento === 'tag') {
      const tags = (entry && entry.tags) || [];
      for (const t of tagOrder) if (tags.includes(t)) return t;
      return 'Senza tag';
    }
    if (raggruppamento === 'cmc') return cmcBucket(card);
    if (raggruppamento === 'colore') return coloreOf(card);
    return tipoOf(card);
  }

  // Ordine dei gruppi-tag: prima apparizione nel mazzo, stabile e prevedibile.
  function tagOrderOf(deck) {
    const seen = [];
    for (const c of deck.carte) {
      for (const t of c.tags || []) if (!seen.includes(t)) seen.push(t);
    }
    return seen;
  }

  // Ogni carta appare UNA sola volta; dentro il gruppo si ordina per CMC crescente, poi per nome. I gruppi extra (override o tag ignoti) vanno in coda, in ordine alfabetico.
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

  // Legalità Commander (§8.4): check PURI su (deck, dati carta) — singleton salvo basics, color identity rispetto al commander, banned list. `violations` sono nomi carta, pronti da mostrare.
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

  // L'override agisce solo sulla vista `view`, senza toccare quelli fatti altrove (#316); gruppo vuoto o null lo rimuove da QUELLA vista. Con una `view` non valida vale il raggruppamento corrente del mazzo, e rimettere lo stesso override è un no-op: stesso riferimento, versione ferma.
  function setGroupOverride(deck, scryfallId, gruppo, view) {
    const id = String(scryfallId || '');
    const v = RAGGRUPPAMENTI.includes(view) ? view : (deck.raggruppamento || 'tipo');
    const g = gruppo ? String(gruppo) : null;
    let changed = false;
    const carte = deck.carte.map((c) => {
      if (c.scryfall_id !== id) return c;
      const cur = (c.gruppo_override && typeof c.gruppo_override === 'object') ? c.gruppo_override : null;
      const before = cur ? cur[v] : undefined;
      if ((before || undefined) === (g || undefined)) return c; // nessun cambiamento reale
      changed = true;
      const nextOv = g
        ? { ...(cur || {}), [v]: g }
        : overrideWithoutView(cur, v);
      const next = { ...c, tags: [...c.tags] };
      if (nextOv && Object.keys(nextOv).length) next.gruppo_override = nextOv;
      else delete next.gruppo_override;
      return next;
    });
    return changed ? touch({ ...deck, carte }) : deck;
  }

  function setRaggruppamento(deck, view) {
    if (!RAGGRUPPAMENTI.includes(view) || view === deck.raggruppamento) return deck;
    return touch({ ...deck, raggruppamento: view });
  }

  // Aggiunge UN tag a UNA carta (#344, trascinandola su una categoria della vista per tag); tag già presente = no-op.
  // L'override manuale della sola VISTA TAG viene rimosso: il trascinamento è un gesto di raggruppamento esplicito e deve vincere, altrimenti la carta resterebbe bloccata nel vecchio gruppo forzato. Gli override delle altre viste restano.
  function addTagToCard(deck, scryfallId, tag) {
    const id = String(scryfallId || '');
    const t = String(tag || '').trim();
    if (!t) return deck;
    let changed = false;
    const carte = deck.carte.map((c) => {
      if (c.scryfall_id !== id) return c;
      const has = c.tags.includes(t);
      const strippedOv = overrideWithoutView(c.gruppo_override, 'tag');
      if (has && strippedOv === c.gruppo_override) return c;
      changed = true;
      const next = { ...c, tags: has ? [...c.tags] : [...c.tags, t] };
      if (strippedOv) next.gruppo_override = strippedOv;
      else delete next.gruppo_override;
      return next;
    });
    return changed ? touch({ ...deck, carte }) : deck;
  }

  // Sostituisce TUTTI i tag ([] li toglie), normalizzati e resi unici conservando l'ordine. Come addTagToCard rimuove l'override della sola vista tag. Mazzo invariato se l'insieme è già quello attuale.
  function replaceCardTags(deck, scryfallId, tags) {
    const id = String(scryfallId || '');
    const uniq = [];
    for (const raw of (Array.isArray(tags) ? tags : [])) {
      const t = String(raw).trim();
      if (t && !uniq.includes(t)) uniq.push(t);
    }
    let changed = false;
    const carte = deck.carte.map((c) => {
      if (c.scryfall_id !== id) return c;
      const same = c.tags.length === uniq.length && c.tags.every((t, i) => t === uniq[i]);
      const strippedOv = overrideWithoutView(c.gruppo_override, 'tag');
      if (same && strippedOv === c.gruppo_override) return c;
      changed = true;
      const next = { ...c, tags: [...uniq] };
      if (strippedOv) next.gruppo_override = strippedOv;
      else delete next.gruppo_override;
      return next;
    });
    return changed ? touch({ ...deck, carte }) : deck;
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
    addTagToCard,
    replaceCardTags,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
