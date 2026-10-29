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
 * Le fusioni sulla linea principale di `ref` che portano un commit che cita #N (la fusione stessa, o un commit del ramo
 * che ha fuso), dalla più nuova. `dopo` (ms) tiene solo le fusioni successive: una datata prima del rilievo non lo
 * chiude. `citazione`: l'oggetto del commit che cita, quando non è la fusione.
 * → [{ sha, data, oggetto, citazione? }]
 */
export function fusioniCheCitano(root, num, { ref = 'origin/main', dopo = 0, max = 20 } = {}) {
  const citanti = git(root, ['log', ref, '-E', `--grep=${regexCitazione(num)}`, `-n${max * 10}`, '--format=%H%x09%s'])
    .split('\n').filter(Boolean).map((r) => { const [sha, ...o] = r.split('\t'); return { sha, oggetto: o.join('\t') }; });
  if (!citanti.length) return [];
  // La linea principale dalla più nuova: la posizione dice quale fusione è venuta prima.
  const linea = new Map(git(root, ['rev-list', '--first-parent', ref]).split('\n').filter(Boolean).map((sha, i) => [sha, i]));
  const perFusione = new Map();
  for (const c of citanti) {
    // La fusione che l'ha portato: la più vecchia della linea principale che discende da lui.
    const fusione = linea.has(c.sha) ? c.sha
      : git(root, ['rev-list', '--ancestry-path', `${c.sha}..${ref}`]).split('\n').filter((x) => linea.has(x))
        .sort((a, b) => linea.get(b) - linea.get(a))[0];
    if (!fusione || perFusione.has(fusione)) continue;
    const [data, ...oggetto] = git(root, ['show', '-s', '--format=%cI%x09%s', fusione]).trim().split('\t');
    const f = { sha: fusione, data, oggetto: oggetto.join('\t') };
    if (fusione !== c.sha) f.citazione = c.oggetto;
    perFusione.set(fusione, f);
  }
  return [...perFusione.values()].filter((f) => !dopo || Date.parse(f.data) > dopo)
    .sort((a, b) => Date.parse(b.data) - Date.parse(a.data)).slice(0, max);
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
 * I file in cui la punta verificata `prima` va in conflitto con `base` di adesso: quelli che un riallineamento ha dovuto
 * risolvere, comunque li abbia risolti (tenere le due parti lascia la modifica del ramo uguale, ma è logica nuova).
 */
export function fileInConflitto(root, { prima, base = 'origin/main' } = {}) {
  let out = '';
  try { out = git(root, ['merge-tree', '--write-tree', '--name-only', '--no-messages', base, prima]); } catch (e) {
    // Uscita 1 = conflitti, coi file dopo l'albero; ogni altra uscita è un guasto.
    if (e.status !== 1) throw e;
    out = String(e.stdout || '');
  }
  return [...new Set(out.split('\n').slice(1).map((r) => r.trim()).filter(Boolean))].sort();
}

/**
 * Dopo un riallineamento, i file in cui la modifica del RAMO è cambiata (la punta verificata contro la sua base, e la
 * punta nuova contro la sua) e quelli che erano in conflitto con main. Un riallineamento pulito dà due elenchi vuoti,
 * anche se main ha cambiato le righe accanto.
 * → { ok: true, file, conflitti, basi } | { ok: false, errore }
 */
export function fileRiscritti(root, { prima, dopo = 'HEAD', base = 'origin/main' } = {}) {
  try {
    const basePrima = git(root, ['merge-base', prima, base]).trim();
    const baseDopo = git(root, ['merge-base', dopo, base]).trim();
    const diff = (da, a) => git(root, ['diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', '--full-index', da, a]);
    const file = fileDiversi(modifichePerFile(diff(basePrima, prima)), modifichePerFile(diff(baseDopo, dopo)));
    return { ok: true, file, conflitti: fileInConflitto(root, { prima, base }), basi: { prima: basePrima, dopo: baseDopo } };
  } catch (e) {
    return { ok: false, errore: String((e && (e.stderr || e.message)) || e).trim().split('\n')[0] };
  }
}

/**
 * I rami su origin con lavoro non ancora su `base`, toccati negli ultimi `giorni`: per ognuno i file che i suoi commit
 * toccano e i numeri di feedback citati (il più citato per primo). Per il manutentore: prima di accendere una
 * sessione si guarda chi lavora già sugli stessi file.
 */
export function ramiInCorso(root, { base = 'origin/main', giorni = 30, adesso = Date.now() } = {}) {
  const nomeBase = base.replace(/^origin\//, '');
  // `--no-merged` toglie in una chiamata sola i rami già arrivati: sono la gran parte, e uno per uno costavano minuti.
  const righe = git(root, ['for-each-ref', `--no-merged=${base}`, '--format=%(refname:short)%09%(committerdate:iso-strict)', 'refs/remotes/origin']).split('\n');
  const rami = [];
  for (const riga of righe.filter(Boolean)) {
    const [ramo, data] = riga.split('\t');
    // `discarded/` sono tentativi messi da parte: non lavora più nessuno.
    if (!ramo || ramo === 'origin/HEAD' || ramo === 'origin' || ramo === `origin/${nomeBase}` || ramo.startsWith('origin/discarded/')) continue;
    if (giorni && adesso - Date.parse(data) > giorni * 86400000) continue;
    // Una chiamata per ramo: per ogni commit l'oggetto (riga marcata) e i file che tocca.
    const log = git(root, ['log', '--no-renames', '--format=\u0001%s', '--name-only', `${base}..${ramo}`]);
    const file = new Set();
    const conta = new Map();
    let avanti = 0;
    for (const r of log.split('\n')) {
      if (r.startsWith('\u0001')) {
        avanti += 1;
        for (const m of r.matchAll(/#(\d{1,7}(?:\.\d{1,4})?)\b/g)) conta.set(m[1], (conta.get(m[1]) || 0) + 1);
      } else if (r.trim()) file.add(r.trim());
    }
    if (!avanti) continue;
    const feedback = [...conta].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    rami.push({ ramo: ramo.replace(/^origin\//, ''), data, avanti, file: [...file].sort(), feedback });
  }
  // Di più tentativi di un worker sullo stesso feedback (`worker/<id>-<ora>`) conta l'ultimo aperto: gli altri sono morti.
  const ultimo = new Map();
  for (const r of rami) {
    const m = /^worker\/([A-Za-z0-9]+)-(\d{8}T\d{6}Z)$/.exec(r.ramo);
    if (m && (!ultimo.has(m[1]) || ultimo.get(m[1]) < m[2])) ultimo.set(m[1], m[2]);
  }
  return rami.filter((r) => {
    const m = /^worker\/([A-Za-z0-9]+)-(\d{8}T\d{6}Z)$/.exec(r.ramo);
    return !m || ultimo.get(m[1]) === m[2];
  }).sort((a, b) => Date.parse(b.data) - Date.parse(a.data));
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
