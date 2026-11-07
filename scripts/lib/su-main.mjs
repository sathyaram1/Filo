// Cosa dice git di main e dei rami in corso, senza modello (SPEC-RIDISEGNO-LAVORO.md §3, regole 3 e 5; § 2 Manutentore).
// Non scarica e non scrive: chi chiama ha già fatto `git fetch`. Le regole sui file stanno in src/shared/verifierRound.js.
// Test: tests/unit/suMain.test.mjs.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { idNelRamo, leggiTentativo, tentativiSuperati, viviInCima } from './tentativi.mjs';

// Caricata solo da chi confronta file: dispatch importa questo modulo anche da una copia degli strumenti senza src/.
const regoleSchede = () => globalThis.SN_SCHEDE || (createRequire(import.meta.url)('../../src/shared/schede.js'), globalThis.SN_SCHEDE);

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

/** I commit della linea principale di `ref` (i primi genitori): ci sta la punta di un ramo nato lì e mai scritto. */
export function lineaPrincipale(root, ref = 'origin/main') {
  return new Set(git(root, ['rev-list', '--first-parent', ref]).split('\n').filter(Boolean));
}

/**
 * Segna `propria` la fusione del lavoro stesso del feedback: quella del cancello («merge-gate: #N …») e quella approvata
 * dall'owner del suo ramo («finish: worker/<id del feedback>-<ora> …»), che il numero non lo dice. La regola sola per
 * la ricerca «già risolto» e per i tentativi superati. PURA.
 */
export function segnaProprie(fusioni, num, id = '') {
  const n = numeroFeedback(num);
  const delCancello = n ? new RegExp(`^merge-gate: #${n.replace('.', '\\.')}\\b(?!\\.\\d)`) : null;
  const nelRamo = idNelRamo(id).replace(/[.]/g, '\\.');
  const delRamo = nelRamo ? new RegExp(`^finish: (?:origin/)?worker/${nelRamo}-\\d{8}T\\d{6}Z\\b`) : null;
  return (Array.isArray(fusioni) ? fusioni : []).map((f) => {
    const oggetto = String((f && f.oggetto) || '');
    return (delCancello && delCancello.test(oggetto)) || (delRamo && delRamo.test(oggetto)) ? { ...f, propria: true } : f;
  });
}

/** La data (ISO) della fusione più recente del lavoro stesso di #N (o del ramo di `id`) su `ref` (segnaProprie), '' se non c'è. */
export function ultimaFusionePropria(root, num, { ref = 'origin/main', id = '' } = {}) {
  if (!numeroFeedback(num)) return '';
  const nelRamo = idNelRamo(id);
  const greps = [`--grep=^merge-gate: ${regexCitazione(num)}`, ...(nelRamo ? [`--grep=^finish: (origin/)?worker/${nelRamo.replace(/[.]/g, '\\.')}-`] : [])];
  const righe = git(root, ['log', '--first-parent', ref, '-E', ...greps, '-n50', '--format=%cI%x09%s']).split('\n').filter(Boolean)
    .map((r) => { const [data, ...o] = r.split('\t'); return { data, oggetto: o.join('\t') }; });
  const propria = segnaProprie(righe, num, id).find((f) => f.propria);
  return propria ? propria.data : '';
}

/** `git merge-tree --write-tree …`: l'uscita anche coi conflitti (uscita 1, albero e file dopo); ogni altra è un guasto. */
function mergeTree(root, args) {
  try { return git(root, ['merge-tree', '--write-tree', '--no-messages', ...args]); } catch (e) {
    if (e.status !== 1) throw e;
    return String(e.stdout || '');
  }
}

/**
 * I file in cui la punta verificata `prima` va in conflitto con `base` di adesso: quelli che un riallineamento ha dovuto
 * risolvere, comunque li abbia risolti (tenere le due parti lascia la modifica del ramo uguale, ma è logica nuova).
 */
export function fileInConflitto(root, { prima, base = 'origin/main' } = {}) {
  const out = mergeTree(root, ['--name-only', base, prima]);
  return [...new Set(out.split('\n').slice(1).map((r) => r.trim()).filter(Boolean))].sort();
}

/**
 * Dopo un riallineamento, i file in cui la punta nuova non è quello che git ottiene da sé rifacendo la modifica
 * verificata sopra la base nuova: lì il correttore ha scritto qualcosa, anche solo spostato una riga nello stesso file
 * (un confronto delle righe cambiate senza la loro posizione non lo vede). Più quelli che erano in conflitto con main.
 * Un riallineamento pulito dà due elenchi vuoti, anche se main ha cambiato le righe vicine.
 * → { ok: true, file, conflitti, basi } | { ok: false, errore }
 */
export function fileRiscritti(root, { prima, dopo = 'HEAD', base = 'origin/main' } = {}) {
  try {
    const basePrima = git(root, ['merge-base', prima, base]).trim();
    const baseDopo = git(root, ['merge-base', dopo, base]).trim();
    const rifatto = mergeTree(root, [`--merge-base=${basePrima}`, baseDopo, prima]).split('\n')[0].trim();
    if (!/^[0-9a-f]{40,64}$/.test(rifatto)) throw new Error(`git merge-tree non ha dato un albero («${rifatto.slice(0, 40)}»)`);
    const file = git(root, ['diff', '--name-only', '--no-renames', '--no-ext-diff', rifatto, dopo])
      .split('\n').map((r) => r.trim()).filter(Boolean).sort();
    return { ok: true, file, conflitti: fileInConflitto(root, { prima, base }), basi: { prima: basePrima, dopo: baseDopo } };
  } catch (e) {
    return { ok: false, errore: String((e && (e.stderr || e.message)) || e).trim().split('\n')[0] };
  }
}

/**
 * I rami su origin con lavoro non ancora su `base`, toccati negli ultimi `giorni`: per ognuno i file che i suoi commit
 * toccano e i numeri di feedback citati (il più citato per primo). Per il manutentore: prima di accendere una
 * sessione si guarda chi lavora già sugli stessi file. Sono rami di lavoro solo `worker/` e `claude/`; `fuori`, se
 * passato, riceve quanti rami restano fuori e perché (`vecchi`, `altri`), da dire a chi legge.
 */
export function ramiInCorso(root, { base = 'origin/main', giorni = 30, adesso = Date.now(), fuori = null } = {}) {
  const nomeBase = base.replace(/^origin\//, '');
  const esclusi = fuori || {};
  esclusi.vecchi = 0;
  esclusi.altri = [];
  // I tentativi superati sono morti; dei vivi di un feedback si mostra quello che la ripresa del lavoro sceglierebbe
  // (la regola sta in tentativi.mjs).
  const tutti = git(root, ['for-each-ref', '--format=%(refname:short)%09%(objectname)', 'refs/remotes/origin/worker']).split('\n')
    .map((r) => r.trim().split('\t')).filter(([ramo, head]) => ramo && head).map(([ramo, head]) => ({ ramo, head }));
  const fusi = new Set(git(root, ['for-each-ref', `--merged=${base}`, '--format=%(refname:short)', 'refs/remotes/origin/worker']).split('\n').map((r) => r.trim()));
  const linea = lineaPrincipale(root, base);
  const superati = tentativiSuperati(tutti.map((t) => ({ ...t, fuso: fusi.has(t.ramo), vuoto: linea.has(t.head) })));
  const perId = new Map();
  for (const t of tutti) {
    const l = leggiTentativo(t.ramo);
    if (l && !superati.has(t.ramo) && !fusi.has(t.ramo)) perId.set(l.id, [...(perId.get(l.id) || []), t]);
  }
  const contiene = (a, b) => { try { git(root, ['merge-base', '--is-ancestor', a.head, b.head]); return true; } catch (_) { return false; } };
  const inCima = new Set([...perId.values()].map((vivi) => (vivi.length > 1 ? viviInCima(vivi, contiene)[0] : vivi[0]).ramo));
  // `--no-merged` toglie in una chiamata sola i rami già arrivati: sono la gran parte, e uno per uno costavano minuti.
  const righe = git(root, ['for-each-ref', `--no-merged=${base}`, '--format=%(refname:short)%09%(committerdate:iso-strict)', 'refs/remotes/origin']).split('\n');
  const rami = [];
  for (const riga of righe.filter(Boolean)) {
    const [ramo, data] = riga.split('\t');
    if (!ramo || ramo === 'origin/HEAD' || ramo === 'origin' || ramo === `origin/${nomeBase}`) continue;
    const tentativo = leggiTentativo(ramo);
    if (tentativo && !inCima.has(ramo)) continue;
    // Riferimenti, prove, parcheggi, `discarded/`: non ci lavora una sessione, ma si contano.
    if (!/^origin\/(worker|claude)\//.test(ramo)) { esclusi.altri.push(ramo.replace(/^origin\//, '')); continue; }
    if (giorni && adesso - Date.parse(data) > giorni * 86400000) { esclusi.vecchi += 1; continue; }
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
  return rami.sort((a, b) => Date.parse(b.data) - Date.parse(a.data));
}

const SERVER = 'filo-security/';

/**
 * Gli incroci con la regola dei file probabili della scheda (SN_SCHEDE.fileNormale e fileStorto, la stessa del server):
 * un assoluto dentro `radice` si rende relativo. `storte`: le voci che non si confrontano. `trova(v)`, se c'è: il
 * percorso com'è in git (anche con altre maiuscole, o del server col prefisso) o '' se non c'è; una voce che non c'è
 * resta, ed è fra le `ignote`. → { voci, storte, ignote }
 */
export function vociDiFile(file, { radice = '', trova = null } = {}) {
  const { fileNormale, fileStorto } = regoleSchede();
  const base = fileNormale(radice).replace(/\/$/, '');
  const voci = [];
  const storte = [];
  const ignote = [];
  for (const grezza of Array.isArray(file) ? file : []) {
    let v = fileNormale(grezza);
    // Windows non distingue le maiuscole nei percorsi: la radice si riconosce comunque.
    if (base && (v + '/').toLowerCase().startsWith(`${base}/`.toLowerCase())) v = v.slice(base.length + 1);
    if (fileStorto(v)) { storte.push(String(grezza)); continue; }
    const vero = typeof trova === 'function' ? trova(v) : v;
    if (vero) voci.push(vero);
    else { voci.push(v); ignote.push(v); }
  }
  return { voci, storte, ignote };
}

/**
 * `trova` per vociDiFile dai file di git dell'app e, se c'è il checkout, del server (null: non si sa). Una cartella
 * vale se un file ci sta dentro. Le maiuscole diverse si correggono solo se il nome è uno. PURA.
 */
export function trovaInGit(fileApp, fileServer = null) {
  const indice = (l) => {
    const esatti = new Set();
    const minuscoli = new Map();
    for (const f of l || []) {
      const parti = f.split('/');
      for (let i = 1; i <= parti.length; i += 1) {
        const p = parti.slice(0, i).join('/') + (i < parti.length ? '/' : '');
        esatti.add(p);
        const k = p.toLowerCase();
        minuscoli.set(k, minuscoli.has(k) && minuscoli.get(k) !== p ? null : p);
      }
    }
    return (v) => {
      if (esatti.has(v)) return v;
      if (!v.endsWith('/') && esatti.has(`${v}/`)) return v;
      return minuscoli.get(v.toLowerCase()) || minuscoli.get(`${v.toLowerCase()}/`)?.replace(/\/$/, '') || '';
    };
  };
  const app = indice(fileApp);
  const server = fileServer ? indice(fileServer) : null;
  return (v) => {
    if (v.startsWith(SERVER)) {
      if (!server) return v;
      const s = server(v.slice(SERVER.length));
      return s ? SERVER + s : '';
    }
    const a = app(v);
    if (a) return a;
    const s = server ? server(v) : '';
    return s ? SERVER + s : '';
  };
}

/**
 * I rami che toccano i file probabili `file`: [{ ramo, feedback, server?, comuni }]. Senza le maiuscole, come Windows; una
 * voce che git non conferma (senza `trova`, o fra le ignote) vale anche per un file del server scritto senza prefisso.
 */
export function incroci(rami, file, { radice = '', trova = null } = {}) {
  const { voci: tutte, ignote } = vociDiFile(file, { radice, trova });
  const incerta = new Set(typeof trova === 'function' ? ignote : tutte);
  const voci = tutte.map((v) => ({ v: v.replace(/\/$/, '').toLowerCase(), incerta: incerta.has(v) }));
  const uguale = (f, v) => f === v || f.startsWith(`${v}/`);
  const tocca = (r) => (f) => {
    const k = f.toLowerCase();
    const senza = r.server && k.startsWith(SERVER) ? k.slice(SERVER.length) : '';
    return voci.some((x) => uguale(k, x.v) || (senza && x.incerta && uguale(senza, x.v)));
  };
  return (Array.isArray(rami) ? rami : [])
    .map((r) => ({ ramo: r.ramo, feedback: r.feedback || [], ...(r.server ? { server: true } : {}), comuni: (r.file || []).filter(tocca(r)) }))
    .filter((r) => r.comuni.length);
}
