// Cosa dice git di main e dei rami in corso, senza modello (SPEC-RIDISEGNO-LAVORO.md §3, regole 3 e 5; § 2 Manutentore).
// Non scarica e non scrive: chi chiama ha già fatto `git fetch`. Le regole sui file stanno in src/shared/verifierRound.js.
// Test: tests/unit/suMain.test.mjs.

import { execFileSync } from 'node:child_process';

const git = (root, args) => execFileSync('git', ['-C', root, '-c', 'core.quotepath=off', ...args], {
  encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});

/** «1680», «#1680», «1680.2» → «1680» / «1680.2»; altrimenti ''. PURA. */
export function numeroFeedback(raw) {
  const m = /^#?(\d{1,7}(?:\.\d{1,4})?)$/.exec(String(raw == null ? '' : raw).trim());
  return m ? m[1] : '';
}

/**
 * L'espressione (ERE di git) che riconosce «#N» citato da solo: #1680 sì, #16800 e il figlio #1680.2 no, la fine
 * della frase («#1680.») sì. PURA.
 */
export function regexCitazione(num) {
  const n = numeroFeedback(num);
  if (!n) throw new Error(`numero di feedback non valido: "${String(num).slice(0, 20)}"`);
  return `#${n.replace('.', '\\.')}($|[^0-9.]|\\.($|[^0-9]))`;
}

/**
 * Le fusioni sulla linea principale di `ref` che citano #N nel messaggio, dalla più nuova. `dopo` (ms) tiene solo
 * quelle successive: una fusione datata prima del rilievo non lo chiude.
 * → [{ sha, data, oggetto }]
 */
export function fusioniCheCitano(root, num, { ref = 'origin/main', dopo = 0, max = 20 } = {}) {
  const out = git(root, ['log', ref, '--first-parent', '-E', `--grep=${regexCitazione(num)}`, `-n${max}`, '--format=%H%x09%cI%x09%s']);
  return out.split('\n').filter(Boolean).map((riga) => {
    const [sha, data, ...oggetto] = riga.split('\t');
    return { sha, data, oggetto: oggetto.join('\t') };
  }).filter((f) => !dopo || Date.parse(f.data) > dopo);
}

/**
 * Una diff -U0 di git → Map file → le sole righe tolte e aggiunte, senza i numeri di riga: due versioni della stessa
 * modifica, prima e dopo un riallineamento, danno lo stesso testo. PURA.
 */
export function modifichePerFile(diff) {
  const mappa = new Map();
  let file = null;
  let righe = [];
  let indice = '';
  let binario = false;
  let dentro = false;
  // L'impronta dei blob conta solo per un binario, di cui la diff non mostra il contenuto: per un testo cambia anche
  // quando cambia solo main.
  const chiudi = () => { if (file) mappa.set(file, (binario ? [indice, ...righe] : righe).join('\n')); };
  for (const riga of String(diff || '').split('\n')) {
    const testa = /^diff --git a\/(.*) b\/(.*)$/.exec(riga);
    if (testa) { chiudi(); file = testa[2]; righe = []; indice = ''; binario = false; dentro = false; continue; }
    if (!file) continue;
    if (riga.startsWith('@@')) { dentro = true; continue; }
    if (!dentro) {
      if (riga.startsWith('index ')) indice = riga.replace(/ \d+$/, '');
      else if (riga.startsWith('Binary files')) binario = true;
      else if (/^(new|deleted) file mode/.test(riga)) righe.push(riga);
      continue;
    }
    if (/^[-+\\]/.test(riga)) righe.push(riga);
  }
  chiudi();
  return mappa;
}

/** I file in cui due mappe di `modifichePerFile` non coincidono, in ordine. PURA. */
export function fileDiversi(prima, dopo) {
  const tutti = new Set([...prima.keys(), ...dopo.keys()]);
  return [...tutti].filter((f) => prima.get(f) !== dopo.get(f)).sort();
}

/**
 * Dopo un riallineamento, i file in cui la modifica del RAMO è cambiata: la punta verificata contro la sua base, e la
 * punta nuova contro la sua. Un riallineamento pulito dà [], anche se main ha cambiato le righe accanto.
 * → { ok: true, file, basi } | { ok: false, errore }
 */
export function fileRiscritti(root, { prima, dopo = 'HEAD', base = 'origin/main' } = {}) {
  try {
    const basePrima = git(root, ['merge-base', prima, base]).trim();
    const baseDopo = git(root, ['merge-base', dopo, base]).trim();
    const diff = (da, a) => git(root, ['diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', '--full-index', da, a]);
    const file = fileDiversi(modifichePerFile(diff(basePrima, prima)), modifichePerFile(diff(baseDopo, dopo)));
    return { ok: true, file, basi: { prima: basePrima, dopo: baseDopo } };
  } catch (e) {
    return { ok: false, errore: String((e && (e.stderr || e.message)) || e).trim().split('\n')[0] };
  }
}

/**
 * I rami su origin con lavoro non ancora su `base`, toccati negli ultimi `giorni`: per ognuno i file che cambia e i
 * numeri di feedback citati nei suoi commit (il più citato per primo). Per il manutentore: prima di accendere una
 * sessione si guarda chi lavora già sugli stessi file.
 */
export function ramiInCorso(root, { base = 'origin/main', giorni = 30, adesso = Date.now() } = {}) {
  const nomeBase = base.replace(/^origin\//, '');
  const righe = git(root, ['for-each-ref', '--format=%(refname:short)%09%(committerdate:iso-strict)', 'refs/remotes/origin']).split('\n');
  const rami = [];
  for (const riga of righe.filter(Boolean)) {
    const [ramo, data] = riga.split('\t');
    if (!ramo || ramo === 'origin/HEAD' || ramo === 'origin' || ramo === `origin/${nomeBase}`) continue;
    if (giorni && adesso - Date.parse(data) > giorni * 86400000) continue;
    const avanti = Number(git(root, ['rev-list', '--count', `${base}..${ramo}`]).trim());
    if (!avanti) continue;
    const mb = git(root, ['merge-base', base, ramo]).trim();
    const file = git(root, ['diff', '--name-only', '--no-renames', mb, ramo]).split('\n').filter(Boolean);
    const conta = new Map();
    for (const m of git(root, ['log', '--format=%s', `${base}..${ramo}`]).matchAll(/#(\d{1,7}(?:\.\d{1,4})?)\b/g)) {
      conta.set(m[1], (conta.get(m[1]) || 0) + 1);
    }
    const feedback = [...conta].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    rami.push({ ramo: ramo.replace(/^origin\//, ''), data, avanti, file, feedback });
  }
  return rami.sort((a, b) => Date.parse(b.data) - Date.parse(a.data));
}

/**
 * I rami che toccano uno dei file: uguale, o dentro una cartella dell'elenco (una voce che finisce con «/»). PURA.
 * → [{ ramo, comuni }]
 */
export function incroci(rami, file) {
  const voci = (Array.isArray(file) ? file : []).map((f) => String(f || '').replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean);
  const tocca = (f) => voci.some((v) => (v.endsWith('/') ? f.startsWith(v) : f === v));
  return (Array.isArray(rami) ? rami : [])
    .map((r) => ({ ramo: r.ramo, feedback: r.feedback || [], comuni: (r.file || []).filter(tocca) }))
    .filter((r) => r.comuni.length);
}
