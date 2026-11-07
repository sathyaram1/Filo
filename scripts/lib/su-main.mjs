// Cosa dice git di main e dei rami in corso, senza modello (SPEC-RIDISEGNO-LAVORO.md §3, regole 3 e 5; § 2 Manutentore).
// Non scarica e non scrive: chi chiama ha già fatto `git fetch`. Le regole sui file stanno in src/shared/verifierRound.js.
// Test: tests/unit/suMain.test.mjs.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { idNelRamo, leggiTentativo, stampoDi, tentativiSuperati, viviInCima } from './tentativi.mjs';

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

/** L'oggetto è la fusione del lavoro stesso di #N («merge-gate: #N …»), non di un altro che lo cita. PURA. */
export function fusionePropria(oggetto, num) {
  return !!numeroFeedback(num) && new RegExp(`^merge-gate: ${regexCitazione(num)}`).test(String(oggetto || ''));
}

/**
 * Il lavoro di ogni feedback arrivato su `ref`, letto sulla linea principale: regge anche dopo la potatura del ramo
 * fuso. «finish: worker/<id>-<stampo>» nomina il tentativo; «merge-gate: #N» solo il numero, che `numeri`
 * ({ N: id }) traduce. → { id: stampo del più recente } per tentativiSuperati.
 */
export function fusioniSuMain(root, { ref = 'origin/main', numeri = {} } = {}) {
  const perNumero = Object.entries(numeri || {}).filter(([n, id]) => numeroFeedback(n) && id);
  const out = {};
  const arriva = (id, stampo) => { if (id && stampo && !(out[id] >= stampo)) out[id] = stampo; };
  const righe = git(root, ['log', '--first-parent', ref, '-E', '--grep=^(merge-gate|finish): ', '--format=%cI%x09%s']).split('\n');
  for (const riga of righe.filter(Boolean)) {
    const [data, ...o] = riga.split('\t');
    const oggetto = o.join('\t');
    const nominato = leggiTentativo((/^(?:merge-gate|finish): (\S+)/.exec(oggetto) || [])[1]);
    if (nominato) { arriva(nominato.id, nominato.stampo); continue; }
    for (const [n, id] of perNumero) if (fusionePropria(oggetto, n)) arriva(id, stampoDi(Date.parse(data)));
  }
  return out;
}

/**
 * Segna `propria` la fusione del lavoro stesso del feedback: quella del cancello (fusionePropria) e quella approvata
 * dall'owner del suo ramo («finish: worker/<id del feedback>-<ora> …»), che il numero non lo dice. La regola sola per
 * la ricerca «già risolto» e per i tentativi superati. PURA.
 */
export function segnaProprie(fusioni, num, id = '') {
  const nelRamo = idNelRamo(id).replace(/[.]/g, '\\.');
  const delRamo = nelRamo ? new RegExp(`^finish: (?:origin/)?worker/${nelRamo}-\\d{8}T\\d{6}Z\\b`) : null;
  return (Array.isArray(fusioni) ? fusioni : []).map((f) => {
    const oggetto = String((f && f.oggetto) || '');
    return fusionePropria(oggetto, num) || (delRamo && delRamo.test(oggetto)) ? { ...f, propria: true } : f;
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
 * passato, riceve quanti rami restano fuori e perché (`vecchi`, `altri`), da dire a chi legge. `numeri` ({ N: id }) come
 * in fusioniSuMain.
 */
export function ramiInCorso(root, { base = 'origin/main', giorni = 30, adesso = Date.now(), fuori = null, numeri = null } = {}) {
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
  const superati = tentativiSuperati(tutti.map((t) => ({ ...t, fuso: fusi.has(t.ramo), vuoto: linea.has(t.head) })),
    { fusioni: fusioniSuMain(root, { ref: base, numeri: numeri || {} }) });
  const perId = new Map();
  for (const t of tutti) {
    const l = leggiTentativo(t.ramo);
    if (l && !superati.has(t.ramo) && !fusi.has(t.ramo)) perId.set(l.id, [...(perId.get(l.id) || []), t]);
  }
  const contiene = (a, b) => { try { git(root, ['merge-base', '--is-ancestor', a.head, b.head]); return true; } catch (_) { return false; } };
  const inCima = new Set([...perId.values()].map((vivi) => (vivi.length > 1 ? viviInCima(vivi, contiene)[0] : vivi[0]).ramo));
  // `--no-merged` toglie in una chiamata sola i rami già arrivati: sono la gran parte, e uno per uno costavano minuti.
  const righe = git(root, ['for-each-ref', `--no-merged=${base}`, '--format=%(refname:short)%09%(committerdate:iso-strict)%09%(objectname)', 'refs/remotes/origin']).split('\n');
  // Nomi di rami e di file li sceglie chi lavora, anche su un feedback non fidato (#2337): escono solo i nomi che il
  // server ha scritto (il tentativo di un feedback dell'indice) e i file che su main ci sono già; il resto si conta.
  // Senza l'indice (chi chiama non passa `numeri`) vale la forma stretta del tentativo: un id corto di sole lettere e cifre.
  const idNoti = numeri ? new Set(Object.values(numeri).map(String)) : null;
  const idValido = (id) => (idNoti ? idNoti.has(id) : /^[A-Za-z0-9]{1,24}$/.test(id));
  const suMain = new Set(git(root, ['ls-tree', '-r', '--name-only', base]).split('\n').filter(Boolean));
  const nome = (ramo, head) => {
    const corto = ramo.replace(/^origin\//, '');
    const l = leggiTentativo(corto);
    if (l && idValido(l.id)) return corto;
    const radice = corto.split('/')[0];
    return `${['worker', 'claude'].includes(radice) ? radice : 'altro'}/(nome non mostrato) @${String(head || '').slice(0, 7)}`;
  };
  const rami = [];
  for (const riga of righe.filter(Boolean)) {
    const [ramo, data, head] = riga.split('\t');
    if (!ramo || ramo === 'origin/HEAD' || ramo === 'origin' || ramo === `origin/${nomeBase}`) continue;
    const tentativo = leggiTentativo(ramo);
    if (tentativo && !inCima.has(ramo)) continue;
    // Riferimenti, prove, parcheggi, `discarded/`: non ci lavora una sessione, ma si contano.
    if (!/^origin\/(worker|claude)\//.test(ramo)) { esclusi.altri.push(nome(ramo, head)); continue; }
    if (giorni && adesso - Date.parse(data) > giorni * 86400000) { esclusi.vecchi += 1; continue; }
    // Una chiamata per ramo: per ogni commit l'oggetto (riga marcata) e i file che tocca.
    const log = git(root, ['log', '--no-renames', '--format=\u0001%s', '--name-only', `${base}..${ramo}`]);
    const file = new Set();
    const nuovi = new Set();
    const conta = new Map();
    let avanti = 0;
    for (const r of log.split('\n')) {
      if (r.startsWith('\u0001')) {
        avanti += 1;
        for (const m of r.matchAll(/#(\d{1,7}(?:\.\d{1,4})?)\b/g)) conta.set(m[1], (conta.get(m[1]) || 0) + 1);
      } else if (r.trim()) (suMain.has(r.trim()) ? file : nuovi).add(r.trim());
    }
    if (!avanti) continue;
    const feedback = [...conta].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    rami.push({ ramo: nome(ramo, head), data, avanti, file: [...file].sort(), ...(nuovi.size ? { fileNuovi: [...nuovi].sort() } : {}), feedback });
  }
  return rami.sort((a, b) => Date.parse(b.data) - Date.parse(a.data));
}

// Un file di filo-security nelle schede e negli elenchi: `filo-security/functions/x.js` (o coi due punti); un ramo del
// server (`repo: 'server'`) porta i suoi percorsi nudi, relativi al suo repo.
const SERVER = 'filo-security/';
const PREFISSO_SERVER = /^filo-security[:/]/;

/** Il file di un ramo come lo legge chi confronta repo diversi: quelli del server col prefisso. PURA. */
export function fileConRepo(r, f) {
  return r && r.repo === 'server' ? `filo-security:${f}` : f;
}

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
    let v = fileNormale(grezza).replace(PREFISSO_SERVER, SERVER);
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
 * I rami che toccano i file probabili `file`: [{ ramo, repo, feedback, comuni }], i comuni di un ramo del server nudi
 * (fileConRepo per mostrarli). Senza le maiuscole, come Windows; una voce che git non conferma (senza `trova`, o fra le
 * ignote) vale anche per un file del server scritto senza prefisso.
 */
export function incroci(rami, file, { radice = '', trova = null } = {}) {
  const { voci: tutte, ignote } = vociDiFile(file, { radice, trova });
  const incerta = new Set(typeof trova === 'function' ? ignote : tutte);
  const voci = tutte.map((v) => ({ v: v.replace(/\/$/, '').toLowerCase(), incerta: incerta.has(v) }));
  const uguale = (f, v) => f === v || f.startsWith(`${v}/`);
  const confronta = (r, prova) => (f) => {
    const nudo = f.toLowerCase();
    const k = r.repo === 'server' ? SERVER + nudo : nudo;
    return voci.some((x) => prova(k, x.v) || (r.repo === 'server' && x.incerta && prova(nudo, x.v)));
  };
  return (Array.isArray(rami) ? rami : [])
    // Un file nuovo del ramo ha il nome di chi lavora (#2337): conta solo uguale a uno della scheda, che lo ripete lei.
    .map((r) => ({ ramo: r.ramo, repo: r.repo || 'app', feedback: r.feedback || [],
      comuni: [...(r.file || []).filter(confronta(r, uguale)), ...(r.fileNuovi || []).filter(confronta(r, (f, v) => f === v))] }))
    .filter((r) => r.comuni.length);
}

/**
 * Le coppie di lavori in corso che toccano gli stessi file, app e filo-security insieme: un lavoro è il ramo dell'app
 * più il suo gemello col nome uguale sul server, e un file del server si confronta solo con file del server. PURA.
 * → [{ a: { ramo, feedback, repo }, b: {…}, comuni: [file, quelli del server col prefisso] }]
 */
export function incrociFraRami(rami) {
  const lavori = new Map();
  for (const r of Array.isArray(rami) ? rami : []) {
    const l = lavori.get(r.ramo) || { ramo: r.ramo, feedback: [], repo: new Set(), file: new Set() };
    l.repo.add(r.repo || 'app');
    for (const n of r.feedback || []) if (!l.feedback.includes(n)) l.feedback.push(n);
    for (const f of r.file || []) l.file.add(fileConRepo(r, f));
    lavori.set(r.ramo, l);
  }
  const elenco = [...lavori.values()];
  const descr = (l) => ({ ramo: l.ramo, feedback: l.feedback, repo: l.repo.size > 1 ? 'app e server' : [...l.repo][0] });
  const coppie = [];
  for (let i = 0; i < elenco.length; i += 1) {
    for (let j = i + 1; j < elenco.length; j += 1) {
      const comuni = [...elenco[i].file].filter((f) => elenco[j].file.has(f)).sort();
      if (comuni.length) coppie.push({ a: descr(elenco[i]), b: descr(elenco[j]), comuni });
    }
  }
  return coppie;
}
