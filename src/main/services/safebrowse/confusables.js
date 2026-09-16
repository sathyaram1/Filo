// Scheletro UTS-39 (sottoinsieme curato) per l'impersonazione stretta: due stringhe sono confondibili se, sostituendo ogni carattere col suo prototipo visivo, collassano sulla stessa sequenza — così "раура1.com" in cirillico finisce sullo scheletro di "paypal".
// Qui c'è solo il sottoinsieme mirato agli attacchi reali sui domini (lookalike cross-script, fullwidth, omoglifi ASCII); leetspeak e refusi li cattura la distanza di edit in signals.js.
// Si mappa sempre verso lettere latine minuscole.

'use strict';

// Aggiungere righe è sicuro: serve solo coerenza, lo stesso char deve mappare sempre allo stesso prototipo.
const MAP = new Map(Object.entries({
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
  'і': 'i', 'ј': 'j', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'в': 'b',
  'ѕ': 's', 'ԁ': 'd', 'һ': 'h', 'ӏ': 'l', 'ԛ': 'q', 'ԝ': 'w', 'ɡ': 'g',
  'ё': 'e', 'ў': 'y', 'я': 'r',
  'α': 'a', 'ο': 'o', 'ρ': 'p', 'ϲ': 'c', 'τ': 't', 'υ': 'u', 'ν': 'v',
  'κ': 'k', 'ι': 'i', 'χ': 'x', 'γ': 'y', 'η': 'n', 'μ': 'u', 'ω': 'w',
  'β': 'b', 'ε': 'e',
  'ո': 'n', 'օ': 'o', 'ս': 'u', 'գ': 'g', 'զ': 'q',
  'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e', 'ｆ': 'f', 'ｇ': 'g',
  'ｈ': 'h', 'ｉ': 'i', 'ｊ': 'j', 'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n',
  'ｏ': 'o', 'ｐ': 'p', 'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't', 'ｕ': 'u',
  'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x', 'ｙ': 'y', 'ｚ': 'z',
  '0': 'o', '1': 'l', '|': 'l', '$': 's', '5': 's', '3': 'e', '4': 'a',
  '7': 't', '@': 'a',
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
  'ñ': 'n', 'ç': 'c', 'ý': 'y', 'ß': 'b',
}));

// NFC, minuscole, poi il prototipo di ogni carattere mappato (i non mappati restano). Si rimuovono i separatori non alfanumerici: un attaccante può spezzare la parola con trattini o punti ("p-a-y-p-a-l").
function skeleton(s) {
  if (!s || typeof s !== 'string') return '';
  const norm = s.normalize('NFC').toLowerCase();
  let out = '';
  for (const ch of norm) {
    const mapped = MAP.get(ch);
    if (mapped !== undefined) { out += mapped; continue; }
    if (/[a-z0-9]/.test(ch)) out += ch;
  }
  return out;
}

// Vero se hanno lo stesso scheletro senza essere già identiche: si assomigliano otticamente pur essendo stringhe diverse.
function looksLike(a, b) {
  if (!a || !b) return false;
  const sa = skeleton(a);
  const sb = skeleton(b);
  return sa.length > 0 && sa === sb;
}

module.exports = { skeleton, looksLike, MAP };
