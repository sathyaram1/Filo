// Import/Export testuale del deck builder Commander (DECK-BUILDER-SPEC.md
// §11, via "Importa…"/"Esporta…" nello switcher, §8.2): parser RIGIDO e
// DETERMINISTICO (mai LLM — quello vive nel prompt della chat, §3), niente
// rete, niente storage: solo testo ↔ struttura dati. Unit test:
// tests/unit/deckImportExport.test.mjs.
//
// Formato: una carta per riga, "<quantità> <Nome>" (standard Moxfield/
// Archidekt, es. "1 Sol Ring"), con un'intestazione opzionale "Commander"
// prima della riga del comandante (per un export/reimport senza perdite).
// Righe che non rispettano lo schema (senza quantità, illeggibili) sono
// SEGNALATE come "sporche", mai indovinate — quello è il lavoro del parser
// tollerante della chat (§3, parseAgentReply in scryfallQuery.js).

(function (global) {
  'use strict';

  // Intestazioni riconosciute (case-insensitive, ":" finale opzionale, conteggio
  // finale "(N)" opzionale — formato Archidekt/TappedOut, es. "Commander (1)",
  // "Deck (99)", "Maybeboard (2)"). Una riga vuota chiude le sezioni "commander"
  // e "mazzo" riportando alla modalità "mazzo" di default (così un file senza
  // intestazioni resta tutto mazzo), ma NON una sezione da saltare
  // (Sideboard/Maybeboard): quella resta attiva finché non arriva una nuova
  // intestazione esplicita, altrimenti una riga vuota dentro il maybeboard
  // farebbe rientrare nel mazzo le carte successive.
  const COMMANDER_HEADERS = ['commander', 'commanders'];
  const DECK_HEADERS = ['deck', 'mainboard', 'maindeck', 'main', 'library'];
  const SKIP_HEADERS = ['sideboard', 'maybeboard', 'considering', 'considerations'];

  const CARD_LINE_RE = /^(\d+)\s*[xX]?\s+(.+)$/;

  // Ripulisce il nome da decorazioni comuni degli export (set/collector number
  // fra parentesi o quadre, marcatore foil) SENZA toccare il nome vero — sono
  // sempre in coda alla riga negli export standard.
  function cleanCardName(raw) {
    let s = String(raw || '').trim();
    s = s.replace(/\s*\*[fF]\*\s*$/, '');
    s = s.replace(/\s*[([][A-Za-z0-9]{2,6}[)\]]\s*[\w-]*\s*$/, '');
    s = s.replace(/\s*\*[fF]\*\s*$/, '');
    return s.trim();
  }

  // Analizza un testo incollato (§11.1): { commanderName, entries, dirtyLines }.
  //   commanderName — nome grezzo sotto l'intestazione "Commander" (solo la
  //     PRIMA riga: la carta commander è un parametro singolo del mazzo,
  //     §13.1); eventuali righe successive nella stessa sezione diventano
  //     entries normali (non si perdono, es. commander in coppia/partner).
  //   entries        — [{ name, qty }] nell'ordine di apparizione.
  //   dirtyLines     — righe non vuote/non intestazione che NON rispettano lo
  //     schema "<qty> <nome>", O con quantità <= 0 (es. "0 Sol Ring", che
  //     significa "non includere questa carta"): segnalate all'utente, mai
  //     importate a caso né normalizzate silenziosamente a 1 copia.
  function parseDecklist(text) {
    const lines = String(text || '').split(/\r?\n/);
    let mode = 'deck'; // 'deck' | 'commander' | 'skip'
    let commanderName = null;
    const entries = [];
    const dirtyLines = [];

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { if (mode !== 'skip') mode = 'deck'; continue; }
      if (/^(#|\/\/)/.test(line)) continue;

      // Normalizza la candidata-intestazione: via il ":" finale e l'eventuale
      // conteggio "(N)" in coda (Archidekt/TappedOut). Le carte vere non
      // rischiano nulla: il confronto resta sull'elenco chiuso di intestazioni.
      const key = line.toLowerCase()
        .replace(/:\s*$/, '')
        .replace(/\s*\(\d+\)\s*$/, '')
        .replace(/:\s*$/, '')
        .trim();
      if (COMMANDER_HEADERS.includes(key)) { mode = 'commander'; continue; }
      if (DECK_HEADERS.includes(key)) { mode = 'deck'; continue; }
      if (SKIP_HEADERS.includes(key)) { mode = 'skip'; continue; }
      if (mode === 'skip') continue;

      const m = CARD_LINE_RE.exec(line);
      if (!m) { dirtyLines.push(raw); continue; }
      // NB: 0 è falsy — un vecchio `parseInt || 1` avrebbe trasformato
      // "0 Sol Ring" in 1 copia. Una quantità 0 (o negativa/illeggibile)
      // vuol dire "non includere": va segnalata come riga non valida.
      const qty = parseInt(m[1], 10);
      if (!Number.isFinite(qty) || qty <= 0) { dirtyLines.push(raw); continue; }
      const name = cleanCardName(m[2]);
      if (!name) { dirtyLines.push(raw); continue; }

      if (mode === 'commander' && !commanderName) commanderName = name;
      else entries.push({ name, qty });
    }

    return { commanderName, entries, dirtyLines };
  }

  // Genera il testo nello STESSO formato (§11.1: "export nello stesso
  // formato"). `entries` = [{ name, qty }] già risolte (nomi reali delle
  // carte, non scryfall_id): la risoluzione id→nome è compito del chiamante
  // (main process, ha la cache Scryfall).
  function formatDecklist({ commanderName, entries } = {}) {
    const lines = [];
    if (commanderName) {
      lines.push('Commander');
      lines.push(`1 ${commanderName}`);
      lines.push('');
    }
    lines.push('Deck');
    for (const e of (entries || [])) {
      const qty = Math.max(1, Number(e && e.qty) || 1);
      const name = String((e && e.name) || '').trim();
      if (name) lines.push(`${qty} ${name}`);
    }
    return lines.join('\n');
  }

  global.SN_DECK_IMPORT_EXPORT = { parseDecklist, formatDecklist, cleanCardName };
})(typeof globalThis !== 'undefined' ? globalThis : self);
