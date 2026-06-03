// UTS-39 "skeleton" (sottoinsieme curato) per l'impersonazione stretta.
//
// L'idea (da Unicode TR39): due stringhe sono "confondibili" se hanno lo stesso
// scheletro, cioè se sostituendo ogni carattere col suo prototipo visivo si
// ottiene la stessa sequenza. Così "раура1.com" (con cirilliche) e "paypal"
// collassano sullo stesso scheletro e l'inganno emerge.
//
// La tabella confusables.txt completa di Unicode ha migliaia di voci; qui c'è
// un sottoinsieme mirato agli attacchi reali sui domini: lookalike cross-script
// (cirillico, greco, armeno), forme fullwidth, e gli omoglifi ASCII più comuni
// (0→o, 1→l). Tutto ciò che resta (leetspeak, refusi) lo cattura la distanza
// di edit in signals.js. Mappiamo sempre verso lettere latine minuscole.

'use strict';

// char (code point) → rappresentante latino. Aggiungere righe è sicuro: serve
// solo coerenza (lo stesso char mappa sempre allo stesso prototipo).
const MAP = new Map(Object.entries({
  // ── Cirillico → latino ────────────────────────────────────────────────
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
  'і': 'i', 'ј': 'j', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'в': 'b',
  'ѕ': 's', 'ԁ': 'd', 'һ': 'h', 'ӏ': 'l', 'ԛ': 'q', 'ԝ': 'w', 'ɡ': 'g',
  'ё': 'e', 'ў': 'y', 'я': 'r',
  // ── Greco → latino ────────────────────────────────────────────────────
  'α': 'a', 'ο': 'o', 'ρ': 'p', 'ϲ': 'c', 'τ': 't', 'υ': 'u', 'ν': 'v',
  'κ': 'k', 'ι': 'i', 'χ': 'x', 'γ': 'y', 'η': 'n', 'μ': 'u', 'ω': 'w',
  'β': 'b', 'ε': 'e',
  // ── Armeno / altri lookalike ──────────────────────────────────────────
  'ո': 'n', 'օ': 'o', 'ս': 'u', 'գ': 'g', 'զ': 'q',
  // ── Fullwidth (U+FF01..FF5E) → ASCII ──────────────────────────────────
  'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e', 'ｆ': 'f', 'ｇ': 'g',
  'ｈ': 'h', 'ｉ': 'i', 'ｊ': 'j', 'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n',
  'ｏ': 'o', 'ｐ': 'p', 'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't', 'ｕ': 'u',
  'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x', 'ｙ': 'y', 'ｚ': 'z',
  // ── Omoglifi ASCII/simboli più comuni ─────────────────────────────────
  '0': 'o', '1': 'l', '|': 'l', '$': 's', '5': 's', '3': 'e', '4': 'a',
  '7': 't', '@': 'a',
  // ── Diacritici latini comuni (mappa "vesti diverse" della stessa lettera)
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
  'ñ': 'n', 'ç': 'c', 'ý': 'y', 'ß': 'b',
}));

// Scheletro confusable di una stringa. Applica NFC, lowercase, poi sostituisce
// ogni carattere col suo prototipo (se mappato). I caratteri non mappati
// restano invariati. Rimuove i separatori non-alfanumerici (un attaccante può
// inserire trattini/punti per spezzare la parola: "p-a-y-p-a-l").
function skeleton(s) {
  if (!s || typeof s !== 'string') return '';
  const norm = s.normalize('NFC').toLowerCase();
  let out = '';
  for (const ch of norm) {
    const mapped = MAP.get(ch);
    if (mapped !== undefined) { out += mapped; continue; }
    // tieni solo lettere/cifre latine; scarta separatori (-, _, .) e residui.
    if (/[a-z0-9]/.test(ch)) out += ch;
  }
  return out;
}

// Vero se `a` e `b` hanno lo stesso scheletro (e non sono già identiche): cioè
// si assomigliano otticamente pur essendo stringhe diverse.
function looksLike(a, b) {
  if (!a || !b) return false;
  const sa = skeleton(a);
  const sb = skeleton(b);
  return sa.length > 0 && sa === sb;
}

module.exports = { skeleton, looksLike, MAP };
