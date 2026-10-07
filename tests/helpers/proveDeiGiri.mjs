// Come si riconosce una prova usa-e-getta guardandola DENTRO, non dal nome.
// Il nome è l'unica cosa che chi scrive può sbagliare; il contenuto no.
// Regola narrata: patterns/le-prove-di-un-giro-stanno-nel-ramo-e-la-cartella-si-svuota.md;
// sentinella: tests/unit/proveDeiGiri.test.mjs.

const APRE_REGEX = /[([{,;:=!&|?+\-*%<>~^]$|\b(return|typeof|instanceof|case|in|of|do|else|yield|await|void|delete|new)$/;

/**
 * Separa un sorgente in codice e stringhe letterali. Commenti e contenuto
 * delle stringhe spariscono dal codice: un `import` citato dentro una
 * stringa è testo, non un import, e un controllo che non lo sa accusa
 * collegamenti rotti che non esistono. PURA.
 */
export function scorri(src) {
  const s = String(src || '');
  let codice = '';
  const stringhe = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') {
      const n = s.indexOf('\n', i);
      i = n === -1 ? s.length : n;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const n = s.indexOf('*/', i + 2);
      i = n === -1 ? s.length : n + 2;
      continue;
    }
    // Una barra dopo un operatore apre un'espressione regolare, e dentro ci
    // stanno virgolette spaiate: senza saltarla lo scorrimento si sfasa.
    if (c === '/' && APRE_REGEX.test(codice.replace(/\s+$/, ''))) {
      i += 1;
      let classe = false;
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === '[') classe = true;
        else if (s[i] === ']') classe = false;
        else if (s[i] === '/' && !classe) break;
        else if (s[i] === '\n') break;
        i += 1;
      }
      i += 1;
      codice += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const prima = codice;
      i += 1;
      let testo = '';
      while (i < s.length) {
        if (s[i] === '\\') { testo += s[i + 1] || ''; i += 2; continue; }
        if (s[i] === c) break;
        testo += s[i];
        i += 1;
      }
      i += 1;
      stringhe.push({ quote: c, testo, prima });
      codice += `${c}${c}`;
      continue;
    }
    codice += c;
    i += 1;
  }
  return { codice, stringhe };
}

/** I percorsi relativi davvero importati dal sorgente (non quelli citati dentro una stringa). PURA. */
export function importRelativi(src) {
  return scorri(src).stringhe
    .filter((s) => s.quote !== '`' && s.testo.startsWith('.'))
    .filter((s) => /\b(from|import)$/.test(s.prima.replace(/[\s(]+$/, '')))
    .map((s) => s.testo);
}

/**
 * Il file registra dei casi di prova (`test(…)`, `test.describe(…)`, `it(…)`)? Un aiuto che
 * esporta `expect` o uno script da lanciare con node no. PURA.
 */
export function registraProve(src) {
  return /(^|[;{}\n])\s*(test|it|describe)(\.(describe|serial|only|skip|fixme|fail|slow|parallel))*\s*\(/
    .test(scorri(src).codice);
}

/** La prova contiene almeno un controllo che può diventare rosso? PURA. */
export function asserisceQualcosa(src) {
  return /\b(expect|assert)\s*[.(]/.test(scorri(src).codice);
}

// Le prime parole non vogliono contesto; «temporaneo» e «provvisorio» sì:
// Filo ha cose temporanee sue, e una prova vera le racconta.
const SEMPRE = /\bthrowaway\b|usa[- ]e[- ]getta|\bdelete after\b|\bTEMP\b/i;
const CON_CONTESTO = /\b(temporane[ao]|provvisori[ao])\b/i;
const PARLA_DI_SE = /\b(prova|spec|test|file)\b/i;

/**
 * La prova si dichiara di passaggio? Si guarda l'intestazione — il blocco di
 * commenti in cima, dove un file dice cos'è — e non una riga di più: sotto si
 * parla di quello che fa Filo, con le stesse parole. PURA.
 */
export function siDichiaraTemporanea(src) {
  for (const riga of String(src || '').split('\n')) {
    if (!/^\s*(\/\/|\/\*|\*)/.test(riga)) {
      if (riga.trim()) break;
      continue;
    }
    if (SEMPRE.test(riga)) return true;
    if (CON_CONTESTO.test(riga) && PARLA_DI_SE.test(riga)) return true;
  }
  return false;
}
