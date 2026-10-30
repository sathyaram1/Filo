// La pulizia del disco del PC su cui si sviluppa Filo (#1409): cartelle di lavoro già fuse e ferme, di Filo e del server,
// e resti delle prove nella temporanea. Senza --togli elenca e basta; lavoro non fuso o non salvato non si tocca mai.
// Regole: tests/unit/pulisciDisco.test.mjs. Uso: npm run pulisci:disco [-- --togli] [--giorni N]

import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, rmSync, statfsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOME_DEI_TEST, ORFANA_DOPO_MS, nomeDiProva } from './lib/nomi-temporanee.mjs';
import { togliCollegamento } from './lib/unit-sulla-fusione.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USO = 'Uso: npm run pulisci:disco [-- --togli] [--giorni N]';
const GIORNO_MS = 24 * 60 * 60 * 1000;
// Toccata da meno di così, sopra una cartella di lavoro può esserci ancora una sessione aperta.
export const FERMA_DA_GIORNI = 2;
export const SOGLIA_LIBERO = 0.05;

// Fuori da git, ma si rifanno da soli o non servono più a nessuno quando il lavoro è fuso. Tutto il resto (chiavi,
// immagini dei feedback, copie dei dati del server, registri della verifica, biglietti) tiene in piedi la cartella.
export const RIGENERABILI = Object.freeze([
  /^(functions\/)?node_modules(\/|$)/,
  /^(dist|generato|test-results|blob-report|tests\/\.report|tests\/\.shots|tests\/\.smoke|tests\/agent\/\.out)\//,
  /^suite-risultati\.json$/,
  /^tests\/\.fb\/[^/]+\.png$/,
  /^tests\/_audit[^/]*\.spec\.mjs$/,
  /^tests\/verifica\/_tolte-[^/]+\//,
  /(^|\/)[^/]+\.(log|err|stackdump)$/,
  /(^|\/)\.DS_Store$/,
  /^\.claude\/(branch-expect|routine-role|routine-ticket|routine-beat|routine-consumo|filo-worker)\.json$/,
  /^\.claude\/(routine-beat-hook\.stamp|cap-observations\.jsonl|settings\.local\.json)$/,
  /^\.claude\/routine-state\//,
]);
const rigenerabile = (p) => RIGENERABILI.some((re) => re.test(p));

export function leggiArgomenti(argv) {
  const a = { togli: false, giorni: FERMA_DA_GIORNI };
  for (let i = 0; i < argv.length; i += 1) {
    const x = argv[i];
    if (x === '--togli') a.togli = true;
    else if (x === '--giorni') {
      const v = String(argv[i + 1] ?? '');
      if (!/^\d+$/.test(v) || Number(v) < 1) return { errore: `--giorni vuole un numero intero da 1 in su, non «${v}»` };
      a.giorni = Number(v);
      i += 1;
    } else return { errore: `argomento che non conosco: ${x}` };
  }
  return a;
}

// Una domanda di credenziali o la rete ferma non tengono appesa la pulizia: si va avanti senza.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
function git(cwd, args, timeout = 0) {
  const r = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout });
  return { code: r.status ?? -1, out: r.stdout || '', err: String(r.stderr || (r.error && r.error.message) || '').trim() };
}
const ultimaRiga = (t) => String(t || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';

/** `git worktree list --porcelain` → le voci, la principale per prima. PURA. */
export function leggiElenco(testo) {
  const voci = [];
  let v = null;
  for (const riga of String(testo || '').split(/\r?\n/)) {
    if (riga.startsWith('worktree ')) {
      v = { dir: resolve(riga.slice(9)), head: '', ramo: '', bloccata: false, sparita: false, nuda: false };
      voci.push(v);
    } else if (!v) continue;
    else if (riga.startsWith('HEAD ')) v.head = riga.slice(5).trim();
    else if (riga.startsWith('branch ')) v.ramo = riga.slice(7).trim().replace(/^refs\/heads\//, '');
    else if (riga === 'bare') v.nuda = true;
    else if (riga === 'locked' || riga.startsWith('locked ')) v.bloccata = true;
    else if (riga === 'prunable' || riga.startsWith('prunable ')) v.sparita = true;
  }
  return voci;
}

/** `git status --porcelain=v1 -z --ignored` → modifiche, file nuovi e file ignorati. PURA. */
export function leggiStato(testo) {
  const out = { modifiche: [], nuovi: [], ignorati: [] };
  const pezzi = String(testo || '').split('\u0000');
  for (let i = 0; i < pezzi.length; i += 1) {
    const e = pezzi[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    const p = e.slice(3);
    if (xy === '??') out.nuovi.push(p);
    else if (xy === '!!') out.ignorati.push(p);
    else {
      out.modifiche.push(p);
      // Rinomina e copia hanno dopo il nome vecchio, in un pezzo suo.
      if (xy[0] === 'R' || xy[0] === 'C') i += 1;
    }
  }
  return out;
}

/** Byte, ultima modifica e collegamenti di una cartella, senza mai attraversare un collegamento. */
export function misura(dir) {
  const out = { byte: 0, ultima: 0, collegamenti: [] };
  try { out.ultima = lstatSync(dir).mtimeMs; } catch (_) { return out; }
  const pila = [dir];
  while (pila.length) {
    const d = pila.pop();
    let nomi = [];
    try { nomi = readdirSync(d); } catch (_) { continue; }
    for (const n of nomi) {
      const p = join(d, n);
      let s;
      try { s = lstatSync(p); } catch (_) { continue; }
      // Su Windows anche la junction di node_modules risponde così: dentro c'è il node_modules di tutti.
      if (s.isSymbolicLink()) { out.collegamenti.push(p); continue; }
      if (s.mtimeMs > out.ultima) out.ultima = s.mtimeMs;
      if (s.isDirectory()) pila.push(p);
      else out.byte += s.size;
    }
  }
  return out;
}

function ultimaFra(dir, nomi) {
  let max = 0;
  for (const n of nomi) {
    try { max = Math.max(max, lstatSync(join(dir, n)).mtimeMs); } catch (_) { /* non c'è */ }
  }
  return max;
}

// Claude Code tiene le sessioni di una cartella in projects/<percorso con ogni carattere non alfanumerico cambiato in ->.
export const cartellaSessioni = (dir, claude) => join(claude, 'projects', resolve(dir).replace(/[^a-zA-Z0-9]/g, '-'));
function ultimaSessione(dir, claude) {
  const d = cartellaSessioni(dir, claude);
  try { return ultimaFra(d, readdirSync(d)); } catch (_) { return 0; }
}

const chiave = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
// Fra due dischi `relative` risponde con un percorso assoluto, senza `..` davanti.
const dentro = (p, cartella) => {
  const r = relative(cartella, p);
  return r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r);
};
const elenca = (xs) => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')} e altri ${xs.length - 3}` : xs.join(', '));
const data = (ms) => new Date(ms).toLocaleDateString('it-IT');

/** I lavori dell'orchestratore locale non ancora fusi: le loro cartelle si tolgono con `orchestra togli`, che salva i rilievi. */
export function lavoriAperti(P) {
  const aperti = new Map();
  let stato = {};
  try { stato = JSON.parse(readFileSync(join(P.note, 'stato.json'), 'utf8')); } catch (_) { return aperti; }
  for (const p of Object.values((stato && stato.pratiche) || {})) {
    if (!p || !p.slug || p.fase === 'fuso') continue;
    for (const wt of [P.wt(p.slug), P.serverRadice && P.wtServer ? P.wtServer(p.slug) : '']) if (wt) aperti.set(chiave(wt), p.num);
  }
  return aperti;
}

/** Il giudizio su una cartella di lavoro: { togli: true, byte, collegamenti, daTogliere } o { togli: false, motivo }. */
export function giudica(v, { repo, qui, aperti, claude, adesso, giorni }) {
  if (chiave(v.dir) === chiave(qui)) return { togli: false, motivo: 'è la cartella da cui parte la pulizia' };
  if (v.bloccata) return { togli: false, motivo: 'bloccata (git worktree lock)' };
  if (aperti.has(chiave(v.dir))) {
    const n = aperti.get(chiave(v.dir));
    return { togli: false, motivo: `lavoro #${n} dell'orchestratore non chiuso: si toglie con npm run orchestra -- togli ${n}` };
  }
  if (!v.head) return { togli: false, motivo: 'senza commit' };
  const su = git(repo, ['merge-base', '--is-ancestor', v.head, 'refs/remotes/origin/main']);
  if (su.code === 1) return { togli: false, motivo: 'non ancora su main' };
  if (su.code !== 0) return { togli: false, motivo: `non riesco a confrontarla con main: ${ultimaRiga(su.err) || `git è uscito con ${su.code}`}` };
  // L'ultima modifica si legge prima di git status, che rinfresca l'indice.
  const gd = git(v.dir, ['rev-parse', '--absolute-git-dir']);
  const ultimaGit = gd.code === 0 ? ultimaFra(gd.out.trim(), ['HEAD', 'index', 'ORIG_HEAD', join('logs', 'HEAD')]) : 0;
  const st = git(v.dir, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--ignored=traditional', '--untracked-files=all']);
  if (st.code !== 0) return { togli: false, motivo: `git status non risponde: ${ultimaRiga(st.err)}` };
  const s = leggiStato(st.out);
  if (s.modifiche.length) return { togli: false, motivo: `modifiche non salvate: ${elenca(s.modifiche)}` };
  const nuovi = s.nuovi.filter((p) => !rigenerabile(p));
  if (nuovi.length) return { togli: false, motivo: `file nuovi non salvati: ${elenca(nuovi)}` };
  const fuori = s.ignorati.filter((p) => !rigenerabile(p));
  if (fuori.length) return { togli: false, motivo: `file fuori da git che non si rifanno da soli: ${elenca(fuori)}` };
  const m = misura(v.dir);
  const ultima = Math.max(m.ultima, ultimaGit, ultimaSessione(v.dir, claude));
  if (adesso - ultima < giorni * GIORNO_MS) {
    return { togli: false, motivo: `usata il ${data(ultima)}, meno di ${giorni} giorni fa: forse c'è una sessione aperta` };
  }
  return { togli: true, byte: m.byte, collegamenti: m.collegamenti, daTogliere: s.nuovi.filter(rigenerabile) };
}

// Prima i collegamenti, uno per uno: una rimozione che ne attraversa uno svuota la cartella a cui punta.
function togliCollegamenti(collegamenti) {
  for (const l of collegamenti) {
    const r = togliCollegamento(l);
    if (!r.ok) return r;
  }
  return { ok: true };
}

function togliDiLavoro(v, g, repo) {
  const c = togliCollegamenti(g.collegamenti);
  if (!c.ok) return { ok: false, motivo: c.motivo };
  for (const p of g.daTogliere) {
    try { rmSync(join(v.dir, p), { recursive: true, force: true }); } catch (e) { return { ok: false, motivo: e.message }; }
  }
  // Senza --force: se nel frattempo qualcuno ci ha scritto, git si rifiuta e la cartella resta.
  const r = git(repo, ['worktree', 'remove', v.dir]);
  return r.code === 0 ? { ok: true } : { ok: false, motivo: ultimaRiga(r.err) || `git è uscito con ${r.code}` };
}

/** Le cartelle col nome delle prove, più vecchie di un giorno. `dove`: [{ base, regola }]. */
export function restiDelleProve(dove, { adesso }) {
  const resti = [];
  for (const { base, regola } of dove) {
    let nomi = [];
    try { nomi = readdirSync(base); } catch (_) { continue; }
    for (const n of nomi) {
      if (!regola(n)) continue;
      const p = join(base, n);
      let s;
      try { s = lstatSync(p); } catch (_) { continue; }
      if (!s.isDirectory() || adesso - s.mtimeMs < ORFANA_DOPO_MS) continue;
      resti.push({ dir: p, gruppo: n.replace(/(?:con spazio-)?(?:[A-Za-z0-9]{6}|[0-9a-f]{12})$/, '') });
    }
  }
  return resti;
}

export function taglia(n) {
  const unita = ['byte', 'KB', 'MB', 'GB', 'TB'];
  let x = Number(n) || 0;
  let i = 0;
  while (x >= 1024 && i < unita.length - 1) { x /= 1024; i += 1; }
  return `${x.toLocaleString('it-IT', { maximumFractionDigits: i >= 3 ? 1 : 0 })} ${unita[i]}`;
}
const numero = (n) => n.toLocaleString('it-IT');
const conta = (n, uno, tanti) => `${numero(n)} ${n === 1 ? uno : tanti}`;

function spazio(p, statfs) {
  try {
    const s = statfs(p);
    return { libero: Number(s.bavail) * Number(s.bsize), totale: Number(s.blocks) * Number(s.bsize) };
  } catch (_) { return null; }
}

function righeSpazio(s, quando, inPiu = 0) {
  if (!s || !s.totale) return [`Spazio libero ${quando}: non riesco a misurarlo.`];
  const quota = (b) => `${Math.round((b / s.totale) * 100)}%`;
  const dopo = inPiu ? `; dopo la pulizia circa ${taglia(s.libero + inPiu)} (${quota(s.libero + inPiu)})` : '';
  const righe = [`Libero ${quando}: ${taglia(s.libero)} su ${taglia(s.totale)} (${quota(s.libero)})${dopo}.`];
  if ((s.libero + inPiu) / s.totale < SOGLIA_LIBERO) {
    righe.push(`Sotto il ${SOGLIA_LIBERO * 100}%${inPiu ? ' anche dopo' : ''}: il resto del disco non sono file di Filo, va liberato a mano.`);
  }
  return righe;
}

async function percorsiVeri() {
  const { percorsi } = await import('./orchestratore-locale.mjs');
  return percorsi();
}

export async function main(argv = process.argv.slice(2), dep = {}) {
  const log = dep.log || ((r) => console.log(r));
  const a = leggiArgomenti(argv);
  if (a.errore) { log(`${a.errore}\n${USO}`); return 2; }
  const adesso = dep.adesso ?? Date.now();
  const P = dep.percorsi || await percorsiVeri();
  const claude = dep.claude || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const temp = dep.temp || tmpdir();
  const casa = dep.casa || homedir();
  const statfs = dep.statfs || statfsSync;
  const aperti = lavoriAperti(P);
  const repos = [{ nome: 'di Filo', radice: P.radice }];
  if (P.serverRadice) repos.push({ nome: 'del server', radice: P.serverRadice });

  const dove = [{ base: temp, regola: nomeDiProva }, { base: casa, regola: (n) => NOME_DEI_TEST.test(n) }];
  const resti = restiDelleProve(dove, { adesso });
  // Quelle dentro un resto sono delle prove (le prove sulla fusione, le prove tolte): se ne vanno con lui, fuse o no.
  const diProva = (v) => resti.some((x) => dentro(v.dir, x.dir));
  let byteTotali = 0;
  let quante = 0;
  const fallite = [];
  const tolte = [];
  for (const r of repos) {
    // Main aggiornato prima del confronto; offline vale l'ultimo scaricato, che basta: quello che c'era, c'è ancora.
    const f = git(r.radice, ['fetch', '--quiet', 'origin', 'main'], 120_000);
    if (f.code !== 0) log(`(non ho aggiornato main ${r.nome}: confronto con l'ultimo scaricato. ${ultimaRiga(f.err)})`);
    const el = git(r.radice, ['worktree', 'list', '--porcelain']);
    if (el.code !== 0) { log(`Cartelle di lavoro ${r.nome} (${r.radice}): git non le elenca: ${ultimaRiga(el.err)}`); continue; }
    const voci = leggiElenco(el.out).slice(1).filter((v) => !v.nuda);
    const sparite = voci.filter((v) => v.sparita);
    const prove = voci.filter((v) => !v.sparita && diProva(v));
    const giudizi = voci.filter((v) => !v.sparita && !diProva(v)).map((v) => ({ v, g: giudica(v, { repo: r.radice, qui: dep.qui || ROOT, aperti, claude, adesso, giorni: a.giorni }) }));
    const via = giudizi.filter((x) => x.g.togli);
    const restano = giudizi.filter((x) => !x.g.togli);
    const nome = (v) => (dentro(v.dir, r.radice) ? relative(r.radice, v.dir) : v.dir);
    const byte = via.reduce((s, x) => s + x.g.byte, 0);
    log(`Cartelle di lavoro ${r.nome} (${r.radice}): ${voci.length} oltre alla principale`);
    log(`  da togliere, ${via.length}${via.length ? ` (${taglia(byte)})` : ''}${via.length ? ':' : ''}`);
    for (const x of via) log(`    ${nome(x.v)} · ${x.v.ramo || x.v.head.slice(0, 8)} · ${taglia(x.g.byte)}`);
    if (restano.length) log(`  restano, ${restano.length}:`);
    for (const x of restano) log(`    ${nome(x.v)} · ${x.v.ramo || x.v.head.slice(0, 8)} · ${x.g.motivo}`);
    if (prove.length) log(`  ${prove.length} delle prove, dentro i loro resti: se ne vanno con loro`);
    if (sparite.length) log(`  ${sparite.length} senza più la cartella: git le dimentica con la pulizia`);
    quante += via.length + sparite.length;
    if (!a.togli) { byteTotali += byte; continue; }
    let n = 0;
    for (const x of via) {
      const esito = togliDiLavoro(x.v, x.g, r.radice);
      if (esito.ok) { n += 1; byteTotali += x.g.byte; } else fallite.push(`${x.v.dir} · ${esito.motivo}`);
    }
    tolte.push(`${conta(n, 'cartella di lavoro', 'cartelle di lavoro')} ${r.nome}`);
  }

  const misure = resti.map((x) => ({ ...x, ...misura(x.dir) }));
  const byteResti = misure.reduce((s, x) => s + x.byte, 0);
  log(`Resti delle prove più vecchi di un giorno (${temp}${casa !== temp ? ` e ${casa}` : ''}): ${numero(misure.length)}${misure.length ? ` (${taglia(byteResti)})` : ''}`);
  const gruppi = new Map();
  for (const x of misure) { const g = gruppi.get(x.gruppo) || { n: 0, byte: 0 }; g.n += 1; g.byte += x.byte; gruppi.set(x.gruppo, g); }
  for (const [g, v] of [...gruppi].sort((p, q) => q[1].byte - p[1].byte)) log(`  ${g}… ${numero(v.n)} (${taglia(v.byte)})`);

  if (!a.togli) {
    byteTotali += byteResti;
    quante += misure.length;
    log(quante ? `Si libererebbero ${taglia(byteTotali)}.` : 'Niente da togliere.');
    for (const riga of righeSpazio(spazio(temp, statfs), 'adesso', byteTotali)) log(riga);
    if (quante) log('Per toglierle: npm run pulisci:disco -- --togli');
    return 0;
  }

  let n = 0;
  for (const x of misure) {
    const c = togliCollegamenti(x.collegamenti);
    try {
      if (!c.ok) throw new Error(c.motivo);
      rmSync(x.dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      n += 1;
      byteTotali += x.byte;
    } catch (e) { fallite.push(`${x.dir} · ${e.message}`); }
    if (n && n % 500 === 0) log(`  …tolti ${numero(n)} su ${numero(misure.length)}`);
  }
  tolte.push(conta(n, 'resto delle prove', 'resti delle prove'));
  // Dopo i resti: fra loro ci sono le cartelle di lavoro delle prove sulla fusione, che git ricorda ancora.
  for (const r of repos) git(r.radice, ['worktree', 'prune']);

  log(`Tolti: ${tolte.join(', ')}; liberati ${taglia(byteTotali)}.`);
  if (fallite.length) {
    log(`Non tolte, ${fallite.length}:`);
    for (const f of fallite) log(`  ${f}`);
  }
  for (const riga of righeSpazio(spazio(temp, statfs), 'alla fine')) log(riga);
  return fallite.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((c) => process.exit(c), (e) => { console.error(`pulisci:disco: ${(e && e.message) || e}`); process.exit(1); });
}
