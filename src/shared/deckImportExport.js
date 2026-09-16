// Import/Export testuale del deck builder Commander (DECK-BUILDER-SPEC.md §11, §8.2): parser RIGIDO e deterministico, mai LLM, niente rete né storage.
// Formato: una carta per riga, «<quantità> <Nome>» (standard Moxfield/Archidekt), intestazione «Commander» opzionale, così l'export si reimporta senza perdite.
// Le righe fuori schema si SEGNALANO, non si indovinano: indovinare è del parser tollerante della chat (§3, parseAgentReply in scryfallQuery.js).

(function (global) {
  'use strict';

  // Intestazioni: case-insensitive, «:» finale e «(N)» in coda opzionali (Archidekt/TappedOut).
  // Una riga vuota chiude «commander» e «mazzo» tornando al mazzo di default (un file senza intestazioni resta tutto mazzo), ma NON una sezione da saltare: lì serve un'intestazione esplicita, altrimenti una riga vuota nel maybeboard rimetterebbe nel mazzo le carte dopo.
  const COMMANDER_HEADERS = ['commander', 'commanders'];
  const DECK_HEADERS = ['deck', 'mainboard', 'maindeck', 'main', 'library'];
  const SKIP_HEADERS = ['sideboard', 'maybeboard', 'considering', 'considerations'];

  const CARD_LINE_RE = /^(\d+)\s*[xX]?\s+(.+)$/;

  // Toglie le decorazioni degli export (set, collector number, marcatore foil) senza toccare il nome: stanno sempre in coda alla riga.
  function cleanCardName(raw) {
    let s = String(raw || '').trim();
    s = s.replace(/\s*\*[fF]\*\s*$/, '');
    s = s.replace(/\s*[([][A-Za-z0-9]{2,6}[)\]]\s*[\w-]*\s*$/, '');
    s = s.replace(/\s*\*[fF]\*\s*$/, '');
    return s.trim();
  }

  // → { commanderName, entries, dirtyLines } (§11.1).
  // commanderName è solo la PRIMA riga sotto «Commander», perché il comandante è un parametro singolo del mazzo (§13.1); le righe dopo diventano entries normali e non si perdono (coppie, partner).
  // dirtyLines: righe fuori dallo schema «<qty> <nome>» o con quantità <= 0 («0 Sol Ring» = non includere). Segnalate, mai importate a caso né normalizzate a una copia.
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

      // Il confronto resta sull'elenco chiuso di intestazioni: le carte vere non rischiano.
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
      // Attenzione: 0 è falsy, e un `parseInt || 1` trasformerebbe «0 Sol Ring» in una copia. Quantità 0, negativa o illeggibile vuol dire «non includere»: riga non valida.
      const qty = parseInt(m[1], 10);
      if (!Number.isFinite(qty) || qty <= 0) { dirtyLines.push(raw); continue; }
      const name = cleanCardName(m[2]);
      if (!name) { dirtyLines.push(raw); continue; }

      if (mode === 'commander' && !commanderName) commanderName = name;
      else entries.push({ name, qty });
    }

    return { commanderName, entries, dirtyLines };
  }

  // `entries` già risolte coi nomi reali: la risoluzione id→nome è del chiamante (il main, che ha la cache Scryfall). Stesso formato dell'import (§11.1).
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
