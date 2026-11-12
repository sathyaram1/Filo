// Import/Export testuale dei mazzi Commander: parser rigido e deterministico, mai LLM.
// Formato «<quantità> <Nome>», una carta per riga, come Moxfield: l'export si reimporta.
// Le righe fuori schema si SEGNALANO, mai indovinate: a indovinare è il parser della chat.

(function (global) {
  'use strict';

  // Intestazioni: case-insensitive, «:» finale e «(N)» in coda opzionali.
  // Una riga vuota torna al mazzo, ma da una sezione saltata si esce con un'intestazione.
  const COMMANDER_HEADERS = ['commander', 'commanders'];
  const DECK_HEADERS = ['deck', 'mainboard', 'maindeck', 'main', 'library'];
  const SKIP_HEADERS = ['sideboard', 'maybeboard', 'considering', 'considerations'];

  const CARD_LINE_RE = /^(\d+)\s*[xX]?\s+(.+)$/;

  // Le decorazioni degli export (set, numero, foil) stanno sempre in coda: si tolgono da lì.
  function cleanCardName(raw) {
    let s = String(raw || '').trim();
    s = s.replace(/\s*\*[fF]\*\s*$/, '');
    s = s.replace(/\s*[([][A-Za-z0-9]{2,6}[)\]]\s*[\w-]*\s*$/, '');
    s = s.replace(/\s*\*[fF]\*\s*$/, '');
    return s.trim();
  }

  // commanderName è solo la PRIMA riga sotto «Commander»: il resto diventa entries normali.
  // dirtyLines: righe fuori schema o con quantità <= 0. Segnalate, mai importate a caso.
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
      // 0 è falsy: un `parseInt || 1` trasformerebbe «0 Sol Ring» in una copia.
      // Quantità 0, negativa o illeggibile vuol dire «non includere»: riga non valida.
      const qty = parseInt(m[1], 10);
      if (!Number.isFinite(qty) || qty <= 0) { dirtyLines.push(raw); continue; }
      const name = cleanCardName(m[2]);
      if (!name) { dirtyLines.push(raw); continue; }

      if (mode === 'commander' && !commanderName) commanderName = name;
      else entries.push({ name, qty });
    }

    return { commanderName, entries, dirtyLines };
  }

  // `entries` arriva già coi nomi reali: la risoluzione id→nome è del chiamante.
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
