// Aiuti delle prove del giro 2 sul lavoro server fase 2: il codice vero del server dal worktree omonimo di filo-security
// (o FILO_SECURITY_DIR), alberi minimi di Filo, GitHub e stato finti. File di supporto, non una prova: si può estendere.

import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SERVER = [
  process.env.FILO_SECURITY_DIR || '',
  resolve(ROOT, '..', '..', '..', '..', 'filo-security', '.claude', 'worktrees', basename(ROOT)),
  resolve(ROOT, '..', 'filo-security'),
].filter(Boolean).find((d) => existsSync(join(d, 'functions', 'src', 'routine', 'fusioneServer.js'))) || '';
export const FUNZIONI = SERVER ? join(SERVER, 'functions') : '';
export const richiediServer = (rel) => createRequire(join(FUNZIONI, 'index.js'))(join(FUNZIONI, rel));

export const sha = (c) => String(c).repeat(40).slice(0, 40);

export function mainDiFilo(rel) {
  return execFileSync('git', ['show', `origin/main:${rel}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function scriviAlbero(dir, file) {
  for (const [rel, testo] of Object.entries(file)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), testo, 'utf8');
  }
  return dir;
}

/** Il `ref` con cui il workflow prende Filo: quello scritto nel passo che porta `repository: sathyaram1/Filo`. */
export function refDiFilo(workflow) {
  const testo = readFileSync(join(SERVER, '.github', 'workflows', workflow), 'utf8').replace(/\r\n/g, '\n');
  const passi = testo.split(/\n(?=\s*- name:)/);
  const passo = passi.find((p) => /repository:\s*sathyaram1\/Filo\b/.test(p));
  if (!passo) throw new Error(`${workflow}: nessun passo prende Filo`);
  const m = /\n\s*ref:\s*([^\n]+)/.exec(passo);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : 'main';
}

/**
 * Quale albero di Filo vede la corsa: `main` (senza la parte dell'app, non ancora fusa) o il ramo omonimo del lavoro.
 * `suRamo`: la corsa parte da una spinta sul ramo del server (suite), non su main del server (pubblicazione).
 */
export function alberoVisto(ref, { suRamo, main, ramo }) {
  if (ref === 'main') return main;
  if (/github\.(ref_name|head_ref|ref)\b/.test(ref)) return suRamo ? ramo : main;
  throw new Error(`ref di Filo che questa prova non sa leggere: «${ref}» (estendi alberoVisto)`);
}

/** Il bake vero del server in un processo suo (i moduli condivisi si registrano su globalThis): i file cambiati. */
export function bakeIn(publicRepo, outDir) {
  const bake = join(FUNZIONI, 'tools', 'bake-shared.js');
  const codice = `const w=require(${JSON.stringify(bake)}).bake({publicRepo:${JSON.stringify(publicRepo)},outDir:${JSON.stringify(outDir)}});`
    + 'process.stdout.write(JSON.stringify(w.filter((x)=>x.changed).map((x)=>x.path)));';
  const r = spawnSync(process.execPath, ['-e', codice], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`bake fallito: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** Lo stato del giro come lo lascia il server dopo il pass della verifica (che ha provato `server`) e della sicurezza. */
export function statoPassato({ app, server, sicurezzaServer = server, ramo }) {
  return {
    verifierVerdict: 'pass', verifiedSha: app, verifiedShaServer: server, lastVerdict: { ticket: 'verificatore', sha: app }, lavoroServer: true,
    secauditDone: true, secauditVerdict: 'pass', secauditSha: app, secauditShaServer: sicurezzaServer, branch: ramo,
  };
}

/** Un registro pulito del ramo del server: le consegne in ordine, l'ultima è la punta. */
export function registro(consegne) {
  return { buco: false, scrittoDa: consegne.map(([biglietto, s, at]) => ({ biglietto, fiducia: 'fidato', sha: s, at, via: 'consegna' })) };
}

/**
 * GitHub finto con i due repo. `server`/`app`: { main, punta, diff }; `suite`: conclusione della suite sulla punta del
 * server. Le chiamate restano in `chiamate`.
 */
export function gitHubFinto({ server, app, suite = 'success' }) {
  const chiamate = [];
  const di = (o) => ((o && o.repo) === 'server' ? server : app);
  const gh = {
    chiamate,
    branchHead: async (ramo, o = {}) => {
      chiamate.push(['branchHead', ramo, o.repo || 'app']);
      const r = di(o);
      if (ramo === 'main') return { ok: true, sha: r.main };
      return r.punta ? { ok: true, sha: r.punta } : { ok: false, reason: 'github_404' };
    },
    confronta: async (base, head, o = {}) => {
      chiamate.push(['confronta', base, head, o.repo || 'app']);
      return { ok: true, status: base === head ? 'identical' : 'ahead', ahead: 1, behind: 0 };
    },
    workflowRuns: async (file, n, o = {}) => {
      chiamate.push(['workflowRuns', file, o.headSha || '', o.repo || 'app']);
      return { ok: true, runs: [{ status: 'completed', conclusion: suite, url: `https://github.com/finto/${file}`, headSha: o.headSha || '' }] };
    },
    compareDiff: async (head, o = {}) => {
      chiamate.push(['compareDiff', head, o.repo || 'app']);
      return { ok: true, diff: di(o).diff || '' };
    },
    avanzaMain: async (s, prima, o = {}) => {
      chiamate.push(['avanzaMain', s, o.repo || 'app']);
      return { ok: true, status: 'merged', sha: s };
    },
    mergeMainInto: async (ramo, msg, o = {}) => {
      chiamate.push(['mergeMainInto', ramo, o.repo || 'app']);
      return { ok: true, status: 'up_to_date' };
    },
  };
  return gh;
}

/** Le dipendenze di cancelloServer senza database: quello che scrive resta in `scritto`. */
export function depsCancello({ github, stato, reg, nowMs = 10_000 }) {
  const scritto = { stato: [], feedback: [], note: [], rimandi: [], owner: [] };
  return {
    scritto,
    deps: {
      github, nowMs, gates: () => ({ passed: true }),
      // La parte dell'app la fonde il cancello di sempre (#1222: prima del server); qui risponde fusa, e la chiamata
      // resta fra quelle di GitHub per l'ordine. Il cancello ha già visto riuscire un suo avanzamento (passo 10 fatto).
      fondiApp: async () => { github.chiamate.push(['fondiApp']); return { ok: true, result: 'merged', sha: sha('5') }; },
      leggiPubblica: async () => ({ cancelloAvanza: { at: 1, via: 'pc' } }),
      scriviPubblica: async () => {},
      readState: async () => stato,
      writeState: async (id, patch) => { scritto.stato.push(patch); },
      scriviFeedback: async (id, campi) => { scritto.feedback.push(campi); },
      readRamo: async () => reg,
      registraSulRamo: async () => {},
      annota: async (id, doc, nota) => { scritto.note.push(nota); },
      realign: async (id, b, ms, x) => { scritto.rimandi.push(x); return true; },
      portaAllOwner: async (id, doc, b, nota) => { scritto.owner.push(nota); return { ok: true }; },
    },
  };
}
