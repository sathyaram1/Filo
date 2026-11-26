// mappa-prove.mjs: gli spec che passano dalle righe che il ramo cambia, letti dalla mappa prova → file che la suite di
// main rifà a ogni corsa (#2502). Senza Electron, in pochi secondi; la mappa si legge dal registro della corsa con gh.
// Uso e formato: `node scripts/mappa-prove.mjs --aiuto`. Logica: scripts/lib/mappaProve.mjs.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blocchiDelDiff, costruisciMappa, durateDaRapporto, mappaDaRegistro, proveDelCambio, righeDelBlocco, righeDellaMappa,
  rigaSullaMappa, unisciRegistrazioni,
} from './lib/mappaProve.mjs';
import { repoDaRemoto } from './rossi-della-suite.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TETTO_BYTE = 256 * 1024 * 1024;
const CORSE_GUARDATE = 15;

const AIUTO = `Uso:
  node scripts/mappa-prove.mjs [--base <rif>] [--diff <file>] [--mappa <file>] [--corsa <id>] [--json] [file…]
      Gli spec che passano dalle righe cambiate, dal più specifico al più largo, col tempo previsto.
      Senza file: il ramo contro --base (origin/main). Con dei file: quei file interi. --diff: un \`git diff -U0\`
      già fatto, con --base sul suo lato di prima. La mappa è quella dell'ultima corsa della suite su main
      (--corsa per un'altra, --mappa per un file).
  node scripts/mappa-prove.mjs unisci --registrazioni <cartella> --out <file>
  node scripts/mappa-prove.mjs costruisci --registrazioni <cartella> [--rapporto <json>] [--commit <sha>] [--corsa <url>] [--out <file>]`;

/** Le opzioni. PURA. */
export function leggiArgomenti(argv) {
  const a = Array.isArray(argv) ? argv.map(String) : [];
  const out = { comando: 'scegli', file: [], json: false };
  const conValore = new Set(['--base', '--diff', '--mappa', '--corsa', '--registrazioni', '--rapporto', '--commit', '--out']);
  let i = 0;
  if (a[0] === 'unisci' || a[0] === 'costruisci') { out.comando = a[0]; i = 1; }
  for (; i < a.length; i += 1) {
    if (a[i] === '--json') out.json = true;
    else if (a[i] === '--aiuto' || a[i] === '--help') out.comando = 'aiuto';
    else if (conValore.has(a[i])) {
      if (a[i + 1] === undefined || a[i + 1].startsWith('--')) return { errore: `${a[i]} vuole un valore` };
      out[a[i].slice(2)] = a[i + 1];
      i += 1;
    } else if (a[i].startsWith('--')) return { errore: `Opzione non capita: ${a[i]}\n\n${AIUTO}` };
    else out.file.push(a[i].replace(/\\/g, '/'));
  }
  if ((out.comando === 'unisci' || out.comando === 'costruisci') && !out.registrazioni) return { errore: `${out.comando} vuole --registrazioni <cartella>` };
  return out;
}

const git = (args, root = ROOT) => {
  try { return { ok: true, out: execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: TETTO_BYTE, stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { ok: false, out: '', errore: String(e.stderr || e.message || e).trim().split('\n')[0] }; }
};
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: TETTO_BYTE, stdio: ['ignore', 'pipe', 'pipe'] });

/** Tutti i JSON di una cartella, anche nelle sottocartelle (gli esiti delle parti arrivano uno per cartella). */
function jsonDi(cartella) {
  const out = [];
  const giro = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) giro(p);
      else if (n.endsWith('.json')) out.push(p);
    }
  };
  if (existsSync(cartella)) giro(cartella);
  return out;
}

function registrazioniDa(cartella) {
  const regs = [];
  let rotte = 0;
  for (const f of jsonDi(cartella)) {
    try {
      const j = JSON.parse(readFileSync(f, 'utf8'));
      regs.push(...(Array.isArray(j) ? j : [j]));
    } catch (_) { rotte += 1; }
  }
  return { regs, rotte };
}

/** La mappa: da un file, o dal registro della corsa della suite (l'ultima su main che ne ha una), con una copia locale. */
export function leggiMappa({ file = '', corsa = '', root = ROOT } = {}) {
  if (file) {
    let testo;
    try { testo = readFileSync(file, 'utf8'); } catch (e) { return { errore: `non leggo ${file}: ${e.message}` }; }
    if (testo.trimStart().startsWith('{')) {
      try { return { mappa: JSON.parse(testo), fonte: file }; } catch (e) { return { errore: `${file} non è JSON: ${e.message}` }; }
    }
    const m = mappaDaRegistro(testo);
    return m.errore ? m : { mappa: m.mappa, fonte: file };
  }
  const repo = process.env.GITHUB_REPOSITORY || repoDaRemoto(git(['remote', 'get-url', 'origin'], root).out);
  if (!repo) return { errore: 'non so quale repo leggere: il remoto origin non è su GitHub' };
  let corse;
  try {
    corse = corsa
      ? [{ id: Number(corsa) }]
      : JSON.parse(gh(['api', `repos/${repo}/actions/workflows/suite.yml/runs?branch=main&status=completed&per_page=${CORSE_GUARDATE}`, '--jq', '[.workflow_runs[] | {id}]']));
  } catch (e) { return { errore: `le corse della suite non si leggono: ${String(e.stderr || e.message).trim().split('\n')[0]}` }; }
  const cache = join(tmpdir(), 'filo-mappa-prove');
  for (const { id } of corse) {
    const copia = join(cache, `${id}.json`);
    if (existsSync(copia)) {
      try { return { mappa: JSON.parse(readFileSync(copia, 'utf8')), fonte: `corsa ${id}` }; } catch (_) {}
    }
    let lavori = [];
    try { lavori = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${id}/jobs?per_page=100`, '--jq', '[.jobs[] | {id, name, status}]'])); } catch (_) { continue; }
    const verdetto = lavori.find((j) => j.name === 'verdetto' && j.status === 'completed');
    if (!verdetto) continue;
    let registro = '';
    try { registro = gh(['api', `repos/${repo}/actions/jobs/${verdetto.id}/logs`]); } catch (_) { continue; }
    const m = mappaDaRegistro(registro);
    if (m.errore) continue;
    try { mkdirSync(cache, { recursive: true }); writeFileSync(copia, JSON.stringify(m.mappa)); } catch (_) {}
    return { mappa: m.mappa, fonte: `corsa ${id}` };
  }
  return { errore: corsa ? `la corsa ${corsa} non ha una mappa nel registro del verdetto` : `nessuna delle ultime ${corse.length} corse della suite su main ha una mappa nel registro del verdetto` };
}

/**
 * Le righe cambiate, nella numerazione del commit della mappa. `diff` è un `git diff -U0` fatto da `primaDi`; i file
 * nominati valgono interi. Senza il commit della mappa qui, le righe restano quelle del diff e si dice.
 */
export function cambiDelDiff({ diff, primaDi = '', file = [], commitMappa = '', root = ROOT }) {
  const cambi = new Map();
  for (const f of file) cambi.set(f, null);
  const { file: blocchi, nuovi, tolti } = blocchiDelDiff(diff || '');
  let nota = '';
  const traducibile = Boolean(primaDi && commitMappa) && git(['cat-file', '-e', `${commitMappa}^{commit}`], root).ok;
  if (primaDi && commitMappa && !traducibile) nota = `il commit della mappa ${commitMappa.slice(0, 10)} qui non c'è (git fetch origin main): le righe del diff le prendo come sono, e possono essere spostate.`;
  for (const [rel, bs] of blocchi) {
    if (!rel.startsWith('src/') || cambi.has(rel)) continue;
    let righe = bs.flatMap(righeDelBlocco);
    if (tolti.includes(rel)) { cambi.set(rel, null); continue; }
    if (traducibile) {
      const d = git(['diff', '-U0', '--no-color', '--no-ext-diff', commitMappa, primaDi, '--', rel], root);
      if (d.ok) {
        const verso = blocchiDelDiff(d.out).file.get(rel) || [];
        righe = righe.map((r) => rigaSullaMappa(r, verso));
      }
    }
    cambi.set(rel, [...new Set(righe)].sort((x, y) => x - y));
  }
  return { cambi, nuovi: nuovi.filter((f) => f.startsWith('src/')), nota };
}

const secondi = (ms) => (ms >= 90_000 ? `${Math.round(ms / 60_000)} min` : `${ms > 0 ? Math.max(1, Math.round(ms / 1000)) : 0} s`);

/** Il testo per chi lavora. PURA. */
export function testoScelta({ prove, senzaProve, nuovi, mappa, fonte, nota = '', specDelRamo = [] }) {
  const righe = [];
  const quando = mappa.creata ? `, ${String(mappa.creata).slice(0, 10)}` : '';
  righe.push(`Mappa prova → file: ${fonte}, commit ${String(mappa.commit || '?').slice(0, 10)}${quando}, ${mappa.prove.length} spec registrati.`);
  if (nota) righe.push(`▸ ${nota}`);
  if (specDelRamo.length) righe.push('', `Spec che il ramo cambia (${specDelRamo.length}): ${specDelRamo.join(', ')}`);
  const perLivello = (l) => prove.filter((p) => p.livello === l);
  const somma = (xs) => xs.reduce((s, p) => s + (p.ms || 0), 0);
  for (const [l, titolo] of [['funzione', 'passano dalle funzioni cambiate'], ['larga', 'passano da funzioni cambiate che quasi tutte le prove eseguono'], ['file', 'caricano solo i file cambiati']]) {
    const xs = perLivello(l);
    if (!xs.length) continue;
    righe.push('', `Spec che ${titolo} (${xs.length}, circa ${secondi(somma(xs))}):`);
    for (const p of xs) righe.push(`  ${p.spec.padEnd(58)} ${secondi(p.ms).padStart(6)}   ${p.file.slice(0, 3).join(', ')}${p.file.length > 3 ? ` e altri ${p.file.length - 3}` : ''}`);
  }
  if (!prove.length) righe.push('', 'Nessuno spec della mappa passa dalle righe cambiate.');
  const fuori = [...new Set([...senzaProve, ...nuovi])];
  if (fuori.length) righe.push('', `Nessuna prova li fa eseguire (nuovi, o mai toccati dalla suite): ${fuori.join(', ')}`);
  righe.push('', `In tutto ${prove.length} spec, circa ${secondi(somma(prove))} in fila. Si lanciano quelli del comportamento cambiato; il resto lo corre la suite su main.`);
  return righe.join('\n');
}

function principale() {
  const opt = leggiArgomenti(process.argv.slice(2));
  if (opt.errore) { console.error(opt.errore); process.exit(2); }
  if (opt.comando === 'aiuto') { console.log(AIUTO); return; }
  if (opt.comando === 'unisci') {
    const { regs, rotte } = registrazioniDa(opt.registrazioni);
    const unite = unisciRegistrazioni(regs, ROOT);
    writeFileSync(opt.out, JSON.stringify(unite));
    console.error(`mappa-prove unisci: ${regs.length} registrazioni (${rotte} illeggibili) in ${unite.length}, in ${opt.out}`);
    return;
  }
  if (opt.comando === 'costruisci') {
    const { regs, rotte } = registrazioniDa(opt.registrazioni);
    let durate = new Map();
    if (opt.rapporto) { try { durate = durateDaRapporto(JSON.parse(readFileSync(opt.rapporto, 'utf8'))); } catch (e) { console.error(`mappa-prove: il rapporto ${opt.rapporto} non si legge (${e.message}), i tempi restano a zero`); } }
    const sorgente = (rel) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch (_) { return null; } };
    const mappa = costruisciMappa({ registrazioni: regs, sorgente, root: ROOT, durate, commit: opt.commit || git(['rev-parse', 'HEAD']).out.trim(), corsa: opt.corsa || '' });
    mappa.creata = new Date().toISOString();
    if (opt.out) writeFileSync(opt.out, JSON.stringify(mappa));
    const righe = righeDellaMappa(mappa);
    for (const r of righe) console.log(r);
    console.error(`mappa-prove costruisci: ${mappa.prove.length} spec, ${Object.keys(mappa.file).length} file, ${mappa.insiemi.length} insiemi, ${righe.length} righe; registrazioni senza prova ${mappa.senzaProva}, illeggibili ${rotte}`);
    return;
  }
  const letta = leggiMappa({ file: opt.mappa || process.env.FILO_MAPPA_PROVE || '', corsa: opt.corsa || '' });
  if (letta.errore) { console.error(`mappa-prove: ${letta.errore}`); process.exit(3); }
  const { mappa, fonte } = letta;
  let diff = '';
  let primaDi = '';
  let specDelRamo = [];
  if (opt.diff) {
    try { diff = readFileSync(opt.diff === '-' ? 0 : opt.diff, 'utf8'); } catch (e) { console.error(`mappa-prove: non leggo ${opt.diff}: ${e.message}`); process.exit(2); }
    primaDi = opt.base || '';
  } else if (!opt.file.length) {
    const base = opt.base || 'origin/main';
    const mb = git(['merge-base', base, 'HEAD']);
    if (!mb.ok) { console.error(`mappa-prove: non trovo la base del ramo con ${base}: ${mb.errore}`); process.exit(2); }
    primaDi = mb.out.trim();
    diff = git(['diff', '-U0', '--no-color', '--no-ext-diff', primaDi]).out;
    specDelRamo = blocchiDelDiff(diff).file.size ? [...blocchiDelDiff(diff).file.keys()].filter((f) => /^tests\/[^/]+\.spec\.mjs$/.test(f)) : [];
  }
  const { cambi, nuovi, nota } = cambiDelDiff({ diff, primaDi, file: opt.file, commitMappa: mappa.commit });
  const { prove, senzaProve } = proveDelCambio(mappa, cambi);
  if (opt.json) { console.log(JSON.stringify({ fonte, commit: mappa.commit, prove, senzaProve, nuovi, specDelRamo, nota }, null, 2)); return; }
  console.log(testoScelta({ prove, senzaProve, nuovi, mappa, fonte, nota, specDelRamo }));
}

const eseguitoDirettamente = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) principale();
