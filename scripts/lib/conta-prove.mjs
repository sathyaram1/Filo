// conta-prove.mjs — conta i casi di prova (test(), it()) che un diff aggiunge, tocca o toglie sotto tests/: il numero
// lo dà lo script, se bastano lo giudica la lettura del diff (#1363). Conta i casi SCRITTI, non quelli eseguiti.
// Regole: tests/unit/contaProve.test.mjs.

// Le prove dei giri di verifica stanno fuori dalla suite e si svuotano: contarle come prove del lavoro gonfierebbe il conto.
export function tipoDiFile(percorso) {
  const p = String(percorso || '').split('\\').join('/');
  if (!p.startsWith('tests/')) return '';
  if (p.startsWith('tests/verifica/')) return /\.spec\.(js|mjs)$/.test(p) ? 'giro' : '';
  if (p.startsWith('tests/unit/') && /\.test\.mjs$/.test(p)) return 'unit';
  if (/\.spec\.(js|mjs)$/.test(p)) return 'spec';
  return '';
}

// filo-security tiene le prove in functions/test/ (*.test.js), quelle dei giri comprese: per il conto valgono come unit.
export function tipoDiFileServer(percorso) {
  return /^functions\/test\/.+\.test\.[cm]?js$/.test(String(percorso || '').split('\\').join('/')) ? 'unit' : '';
}

/** Dove un repo tiene le prove, e come si riconosce un file di prova: l'app e il server (#2049). */
export const PROVE_APP = Object.freeze({ cartella: 'tests/', tipo: tipoDiFile });
export const PROVE_SERVER = Object.freeze({ cartella: 'functions/test/', tipo: tipoDiFileServer });

const ID = /[A-Za-z0-9_$]/;
const PRIMA_DI_REGEX = '(,=:[!&|?{};+-*%<>~^';
const PAROLE_PRIMA_DI_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);

/** 1 dove il carattere è codice, 0 dentro stringhe, commenti, regex e testo dei template. PURA. */
export function mascheraCodice(src) {
  const s = String(src || '');
  const n = s.length;
  const m = new Uint8Array(n);
  const stringa = (i, q) => {
    let j = i + 1;
    while (j < n && s[j] !== q && s[j] !== '\n') j += s[j] === '\\' ? 2 : 1;
    return j + 1;
  };
  const regex = (i) => {
    let j = i + 1;
    let classe = false;
    while (j < n) {
      const c = s[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '\n') return j;
      if (classe) { if (c === ']') classe = false; } else if (c === '[') classe = true; else if (c === '/') { j++; break; }
      j++;
    }
    while (j < n && /[a-z]/i.test(s[j])) j++;
    return j;
  };
  let codice;
  const template = (i) => {
    let j = i;
    while (j < n) {
      if (s[j] === '\\') { j += 2; continue; }
      if (s[j] === '`') return j + 1;
      if (s[j] === '$' && s[j + 1] === '{') { j = codice(j + 2, true); continue; }
      j++;
    }
    return n;
  };
  codice = (i, graffa) => {
    let j = i;
    let prof = 0;
    let prec = '';
    let parola = '';
    while (j < n) {
      const c = s[j];
      const d = s[j + 1];
      if (c === '/' && d === '/') { const k = s.indexOf('\n', j); j = k < 0 ? n : k; continue; }
      if (c === '/' && d === '*') { const k = s.indexOf('*/', j + 2); j = k < 0 ? n : k + 2; continue; }
      if (c === '\'' || c === '"') { j = stringa(j, c); prec = c; parola = ''; continue; }
      if (c === '`') { j = template(j + 1); prec = '`'; parola = ''; continue; }
      if (c === '/' && (!prec || PRIMA_DI_REGEX.includes(prec) || PAROLE_PRIMA_DI_REGEX.has(parola))) {
        j = regex(j); prec = '/'; parola = ''; continue;
      }
      if (graffa) {
        if (c === '{') prof++;
        else if (c === '}') { if (prof === 0) return j + 1; prof--; }
      }
      m[j] = 1;
      if (!/\s/.test(c)) {
        if (ID.test(c)) parola = j > 0 && m[j - 1] && ID.test(s[j - 1]) ? parola + c : c;
        else parola = '';
        prec = c;
      }
      j++;
    }
    return n;
  };
  codice(0, false);
  return m;
}

const APRE = '([{';
const CHIUDE = ')]}';

// Gli argomenti di primo livello della chiamata che apre alla parentesi `i`, e dove finisce. null se non si chiude.
function argomenti(s, m, i) {
  const args = [];
  let prof = 0;
  let da = i + 1;
  for (let j = i; j < s.length; j++) {
    if (!m[j]) continue;
    const c = s[j];
    if (APRE.includes(c)) prof++;
    else if (CHIUDE.includes(c)) {
      prof--;
      if (prof === 0) {
        const ultimo = s.slice(da, j).trim();
        if (ultimo || args.length) args.push(ultimo);
        return { args, fine: j + 1 };
      }
    } else if (c === ',' && prof === 1) { args.push(s.slice(da, j).trim()); da = j + 1; }
  }
  return null;
}

const FUNZIONE = /^(async\s+)?(function\b|\([^]*?\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;
const CHIAMATA = /(?<![\w$.])(test|it)(?:\.(only|skip|fail|fixme))?\s*\(/g;

// Un titolo letterale si legge senza virgolette né barre di escape; uno calcolato resta com'è scritto.
function titoloLeggibile(arg) {
  const t = String(arg || '').trim();
  const q = /^(['"`])((?:\\[^]|(?!\1)[^\\])*)\1$/.exec(t);
  if (!q || (q[1] === '`' && q[2].includes('${'))) return t;
  return q[2].replace(/\\([^])/g, '$1');
}

/**
 * I casi di prova scritti in un sorgente: `test(titolo, …, fn)`, `it(…)`, e le varianti only/skip/fail/fixme che
 * DICHIARANO un caso. `test.skip(condizione, motivo)` dentro un caso non lo è. PURA.
 */
export function casiDiProva(src) {
  const s = String(src || '');
  const m = mascheraCodice(s);
  const casi = [];
  for (const x of s.matchAll(CHIAMATA)) {
    if (!m[x.index]) continue;
    const aperta = x.index + x[0].length - 1;
    if (!m[aperta]) continue;
    const a = argomenti(s, m, aperta);
    if (!a || a.args.length < 2) continue;
    const ultimo = a.args[a.args.length - 1];
    const variante = x[2] || '';
    const eFunzione = FUNZIONE.test(ultimo);
    // Col solo nome di una funzione per ultimo, `test(t, corpo)` è un caso; `test.skip(cond, motivo)` no.
    if (!eFunzione && !(['', 'only'].includes(variante) && /^[A-Za-z_$][\w$.]*$/.test(ultimo))) continue;
    casi.push({ titolo: titoloLeggibile(a.args[0]), testo: s.slice(x.index, a.fine) });
  }
  return casi;
}

// Lo stesso titolo due volte nello stesso file resta due casi: la chiave porta l'occorrenza.
function perChiave(casi) {
  const visti = new Map();
  const out = new Map();
  for (const c of casi) {
    const k = visti.get(c.titolo) || 0;
    visti.set(c.titolo, k + 1);
    out.set(`${c.titolo}\u0000${k}`, c);
  }
  return out;
}

const normalizza = (t) => String(t || '').replace(/\s+/g, ' ').trim();

/** Prima e dopo dello stesso file → titoli aggiunti, toccati (stesso titolo, corpo diverso) e tolti. PURA. */
export function confrontaCasi(prima, dopo) {
  const a = perChiave(casiDiProva(prima));
  const b = perChiave(casiDiProva(dopo));
  const out = { aggiunti: [], toccati: [], tolti: [] };
  for (const [k, c] of b) {
    if (!a.has(k)) out.aggiunti.push(c.titolo);
    else if (normalizza(a.get(k).testo) !== normalizza(c.testo)) out.toccati.push(c.titolo);
  }
  for (const [k, c] of a) if (!b.has(k)) out.tolti.push(c.titolo);
  return out;
}

const vuoto = () => ({ aggiunti: 0, toccati: 0, tolti: 0 });

/**
 * `file`: [{ percorso, prima, dopo }] (prima null = file nuovo, dopo null = file tolto; per un file spostato il
 * percorso è quello nuovo). `prove`: le regole del repo (PROVE_APP o PROVE_SERVER). → il conto per file e per tipo; i
 * giri di verifica a parte. PURA.
 */
export function contaProve(file, { prove = PROVE_APP } = {}) {
  const perFile = [];
  const totali = { unit: vuoto(), spec: vuoto(), giro: vuoto() };
  for (const f of Array.isArray(file) ? file : []) {
    const tipo = prove.tipo(f && f.percorso);
    if (!tipo) continue;
    const c = confrontaCasi(f.prima || '', f.dopo || '');
    if (!c.aggiunti.length && !c.toccati.length && !c.tolti.length) continue;
    perFile.push({ percorso: f.percorso, tipo, ...c });
    for (const k of ['aggiunti', 'toccati', 'tolti']) totali[tipo][k] += c[k].length;
  }
  const lavoro = vuoto();
  for (const t of ['unit', 'spec']) for (const k of Object.keys(lavoro)) lavoro[k] += totali[t][k];
  return { perFile, totali, lavoro };
}

const ELENCO_MAX = 12;
const titoli = (l) => (l.length > ELENCO_MAX ? [...l.slice(0, ELENCO_MAX), `… e altri ${l.length - ELENCO_MAX}`] : l)
  .map((t) => `«${normalizza(t).slice(0, 100)}»`).join(', ');

/** La riga del conto, quella che va nel riassunto della critica. PURA. */
export function rigaDelConto(conto) {
  const l = (conto && conto.lavoro) || vuoto();
  const t = (conto && conto.totali) || { unit: vuoto(), spec: vuoto() };
  return `prove aggiunte ${l.aggiunti} (unit ${t.unit.aggiunti}, spec ${t.spec.aggiunti}), toccate ${l.toccati}, tolte ${l.tolti}`;
}

/** Il conto per esteso, per chi legge il diff: riga, file per file, giri a parte, codice cambiato. PURA. */
export function testoDelConto(conto, { codice = [], prove = PROVE_APP } = {}) {
  const righe = [`Prove del lavoro, contate dallo script: ${rigaDelConto(conto)}.`];
  for (const f of (conto && conto.perFile) || []) {
    if (f.tipo === 'giro') continue;
    righe.push(`- ${f.percorso} (${f.tipo}): ${[
      f.aggiunti.length ? `aggiunti ${f.aggiunti.length}: ${titoli(f.aggiunti)}` : '',
      f.toccati.length ? `toccati ${f.toccati.length}: ${titoli(f.toccati)}` : '',
      f.tolti.length ? `tolti ${f.tolti.length}: ${titoli(f.tolti)}` : '',
    ].filter(Boolean).join('; ')}`);
  }
  const g = (conto && conto.totali && conto.totali.giro) || vuoto();
  if (g.aggiunti || g.toccati || g.tolti) {
    righe.push(`Prove dei giri di verifica (fuori dalla suite, non contano qui): aggiunte ${g.aggiunti}, toccate ${g.toccati}, tolte ${g.tolti}.`);
  }
  const cod = Array.isArray(codice) ? codice : [];
  if (cod.length) {
    const piu = cod.reduce((k, c) => k + (Number(c.aggiunte) || 0), 0);
    const meno = cod.reduce((k, c) => k + (Number(c.tolte) || 0), 0);
    righe.push(`Codice cambiato fuori da ${prove.cartella}: ${cod.length} file, +${piu} −${meno} righe.`);
    for (const c of cod) righe.push(`- ${c.percorso}: +${c.aggiunte} −${c.tolte}`);
  } else {
    righe.push(`Codice cambiato fuori da ${prove.cartella}: nessun file.`);
  }
  return righe.join('\n');
}
