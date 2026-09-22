// Come si riconosce una prova usa-e-getta guardandola DENTRO, non dal nome.
// Il nome è l'unica cosa che chi scrive può sbagliare; il contenuto no.
// La regola narrata sta in CLAUDE.md § Verifica, la sentinella in tests/unit/proveDeiGiri.test.mjs.

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

/** La prova contiene almeno un controllo che può diventare rosso? PURA. */
export function asserisceQualcosa(src) {
  return /\b(expect|assert)\s*[.(]/.test(scorri(src).codice);
}

// Le parole con cui una prova nata per un giro dice di sé che è di passaggio:
// chi la scrive lo annota sempre, ed è l'unico segnale che non dipende dal nome.
const DICHIARAZIONI = /\b(throwaway|usa[- ]e[- ]getta|temporane[ao]|provvisori[ao]|delete after|TEMP)\b/i;

/**
 * La prova si dichiara di passaggio? Si guardano le prime due righe, dove un
 * file dice cos'è: più giù si parla di quello che fa Filo, e una prova vera
 * che nomina un «cancella» dell'app non deve finire accusata. PURA.
 */
export function siDichiaraTemporanea(src) {
  const testa = String(src || '').split('\n')
    .filter((r) => /^\s*(\/\/|\/\*|\*)/.test(r) || !r.trim())
    .slice(0, 2).join('\n');
  return DICHIARAZIONI.test(testa);
}
