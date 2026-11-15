// La prova del test nuovo, senza modello (#2505): i casi nuovi o cambiati del ramo corsi senza il lavoro (rosso atteso) e
// con (verde atteso). Non decide niente: scrive l'esito che la consegna porta. Prove: tests/unit/provaTestNuovi.test.mjs.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { confrontaCasi, PROVE_APP, PROVE_SERVER } from './conta-prove.mjs';
import { preparaLancioElectron } from './schermo-virtuale.mjs';

export const VERSIONE = 1;
// Uno spec lento sta sotto i dieci minuti; oltre, il file conta come «errore», non come rosso.
const TETTO_FILE_MS = 20 * 60 * 1000;

function git(root, args, input) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'], ...(input ? { input } : {}) });
}
const mostra = (root, rev, f) => { try { return git(root, ['show', `${rev}:${f}`]); } catch (_) { return null; } };

/**
 * I file di prova toccati fra base e punta coi loro casi aggiunti o cambiati; le prove di un giro di verifica no.
 * `prove`: PROVE_APP o PROVE_SERVER. → [{ file, tipo, casi: [titolo] }]
 */
export function testNuoviDelRamo(root, base, head, { prove = PROVE_APP } = {}) {
  const out = git(root, ['diff', '--name-status', '-M', '-z', base, head, '--', prove.cartella]).split('\0').filter(Boolean);
  const voci = [];
  for (let i = 0; i < out.length; i++) {
    const st = out[i];
    const file = st.startsWith('R') || st.startsWith('C') ? out[i += 2] : out[i += 1];
    const prima = st.startsWith('R') || st.startsWith('C') ? out[i - 1] : file;
    if (st.startsWith('D')) continue;
    const tipo = prove.tipo(file);
    if (tipo !== 'unit' && tipo !== 'spec') continue;
    const c = confrontaCasi(mostra(root, base, prima) || '', mostra(root, head, file) || '');
    const casi = [...c.aggiunti, ...c.toccati];
    if (casi.length) voci.push({ file, tipo, casi });
  }
  return voci;
}

/** I file sotto la cartella delle prove che il ramo aggiunge o cambia: nella copia senza il lavoro vanno com'erano sulla punta. */
function proveDellaPunta(root, base, head, cartella) {
  return git(root, ['diff', '--name-only', '--diff-filter=ACMR', '-z', base, head, '--', cartella]).split('\0').filter(Boolean);
}

/** Una copia staccata di `sha` con le dipendenze collegate e i file generati che git ignora. { dir, chiudi } */
export function apriCopia(root, sha, { moduli = ['node_modules'] } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'filo-prova-nuovi-'));
  const dir = join(base, 'albero');
  mkdirSync(join(base, 'ganci'));
  git(root, ['-c', `core.hooksPath=${join(base, 'ganci')}`, 'worktree', 'add', '-q', '--detach', dir, sha]);
  for (const m of moduli) if (existsSync(resolve(root, m))) symlinkSync(resolve(root, m), join(dir, m), 'junction');
  // Le chiavi predefinite e gli altri generati ignorati servono all'app quanto i sorgenti.
  for (const f of git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', 'src']).split('\0').filter(Boolean)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    copyFileSync(resolve(root, f), join(dir, f));
  }
  const chiudi = () => {
    try { git(root, ['worktree', 'remove', '--force', dir]); } catch (_) { /* la cartella si toglie sotto */ }
    try { rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) { /* resta nella temporanea */ }
  };
  return { dir, base, chiudi };
}

/** Le righe TAP di `node --test`: titolo → verde/rosso; i casi saltati non contano. PURA. */
export function esitiDaTap(tap) {
  const esiti = new Map();
  for (const riga of String(tap || '').split(/\r?\n/)) {
    const m = /^\s*(not )?ok \d+ - (.*?)(\s+#\s*(SKIP|TODO)\b.*)?$/.exec(riga);
    if (!m || m[3]) continue;
    const titolo = m[2].replace(/\\#/g, '#').trim();
    // Un titolo ripetuto (due describe) è rosso se lo è una delle sue occorrenze.
    esiti.set(titolo, esiti.get(titolo) === 'rosso' ? 'rosso' : (m[1] ? 'rosso' : 'verde'));
  }
  return esiti;
}

/** Il rapporto JSON di Playwright: titolo → verde/rosso (rosso se l'ultimo tentativo non è passato). PURA. */
export function esitiDaPlaywright(rapporto) {
  const esiti = new Map();
  const visita = (suite) => {
    for (const s of (suite && suite.specs) || []) {
      const ok = (s.tests || []).every((t) => ['expected', 'skipped', 'flaky'].includes(t.status));
      const saltato = (s.tests || []).every((t) => t.status === 'skipped');
      if (!saltato) esiti.set(s.title, esiti.get(s.title) === 'rosso' ? 'rosso' : (ok ? 'verde' : 'rosso'));
    }
    for (const c of (suite && suite.suites) || []) visita(c);
  };
  for (const s of (rapporto && rapporto.suites) || []) visita(s);
  return esiti;
}

/** Un file di prova in una copia: { esiti: Map, partito: bool, errore? }. `partito` falso = il file non arriva ai casi. */
export function corriFile(dir, voce, { lancia = spawnSync, prepara = preparaLancioElectron, env = process.env, cwdRel = '' } = {}) {
  const cwd = cwdRel ? join(dir, cwdRel) : dir;
  const rel = cwdRel ? voce.file.slice(cwdRel.length + 1) : voce.file;
  const { NODE_TEST_CONTEXT: _figlio, ...pulito } = env;
  if (voce.tipo === 'unit') {
    const r = lancia(process.execPath, ['--test', '--test-reporter=tap', rel], { cwd, env: pulito, encoding: 'utf8', timeout: TETTO_FILE_MS, maxBuffer: 1 << 26 });
    if (r.error && r.error.code === 'ETIMEDOUT') return { esiti: new Map(), partito: false, errore: 'oltre il tetto di tempo' };
    if (r.error) return { esiti: new Map(), partito: false, errore: `node non parte (${r.error.code || r.error.message})` };
    return { esiti: esitiDaTap(r.stdout), partito: true };
  }
  const rapporto = join(dirname(dir), `rapporto-${Math.random().toString(36).slice(2)}.json`);
  const l = prepara('npx', ['playwright', 'test', rel, '--retries=0', '--reporter=json']);
  if (!l.ok) return { esiti: new Map(), partito: false, errore: l.motivo };
  const r = lancia(l.cmd, l.args, { cwd, env: { ...(l.env || pulito), PLAYWRIGHT_JSON_OUTPUT_FILE: rapporto }, encoding: 'utf8', timeout: TETTO_FILE_MS, maxBuffer: 1 << 26, shell: process.platform === 'win32' });
  if (r.error && r.error.code === 'ETIMEDOUT') return { esiti: new Map(), partito: false, errore: 'oltre il tetto di tempo' };
  let json = null;
  try { json = JSON.parse(readFileSync(rapporto, 'utf8')); } catch (_) { /* senza rapporto lo spec non è partito */ }
  // Playwright scrive il rapporto anche quando lo spec non si carica: senza, è il lancio che non è partito, e un
  // «rosso senza il lavoro» sembrerebbe l'esito atteso.
  if (!json) return { esiti: new Map(), partito: false, errore: `playwright non ha scritto il rapporto${r.error ? ` (${r.error.code || r.error.message})` : ''}: ${String(r.stderr || r.stdout || '').trim().split('\n').slice(-1)[0].slice(0, 160)}` };
  return { esiti: esitiDaPlaywright(json), partito: true };
}

/**
 * Un caso, dai due giri. Senza il lavoro un caso che non si trova (il file non parte, o il caso non c'è) è rosso:
 * manca proprio quello che il lavoro porta. Con il lavoro, un caso che non si trova è «non trovato». PURA.
 */
export function esitoDelCaso(titolo, senza, con) {
  const s = senza.esiti.get(titolo) || (senza.errore ? 'errore' : 'rosso');
  const c = con.esiti.get(titolo) || (con.errore ? 'errore' : 'non trovato');
  return { senza: s, con: c };
}

/**
 * La prova di un repo: { base, punta, casi: [{ file, caso, senza, con }], verdiSenza, nonVerdiCon }.
 * `prove`: le regole del repo; `moduli`: le cartelle di dipendenze da collegare; `cwdRel`: dove si lanciano le prove
 * (la cartella delle functions nel server). `corri` è iniettabile per i test.
 */
export function provaTestNuovi({ root, base, head, prove = PROVE_APP, moduli = ['node_modules'], cwdRel = '', corri = corriFile, log = () => {} } = {}) {
  const voci = testNuoviDelRamo(root, base, head, { prove });
  const casi = [];
  if (voci.length) {
    const senza = apriCopia(root, base, { moduli });
    const con = apriCopia(root, head, { moduli });
    try {
      for (const f of proveDellaPunta(root, base, head, prove.cartella)) {
        const dest = join(senza.dir, f);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, execFileSync('git', ['show', `${head}:${f}`], { cwd: root, maxBuffer: 1 << 28 }));
      }
      for (const v of voci) {
        log(`${v.file}: ${v.casi.length} ${v.casi.length === 1 ? 'caso' : 'casi'}, senza il lavoro e con`);
        const s = corri(senza.dir, v, { cwdRel });
        const c = corri(con.dir, v, { cwdRel });
        for (const t of v.casi) casi.push({ file: v.file, caso: t, ...esitoDelCaso(t, s, c) });
      }
    } finally { senza.chiudi(); con.chiudi(); }
  }
  return {
    versione: VERSIONE, base, punta: head, casi,
    verdiSenza: casi.filter((c) => c.senza === 'verde').length,
    nonVerdiCon: casi.filter((c) => c.con !== 'verde').length,
  };
}

/** L'esito in righe da leggere: un caso verde anche senza il lavoro esce segnalato. PURA. */
export function testoDellaProva(p, etichetta = '') {
  const testa = etichetta ? `${etichetta}: ` : '';
  if (!p || !Array.isArray(p.casi)) return `${testa}prova dei test nuovi non fatta`;
  if (!p.casi.length) return `${testa}nessun caso di prova nuovo o cambiato nel ramo`;
  const righe = p.casi.map((c) => {
    const s = globalThis.SN_CONSEGNA.casoSegnalato(c);
    const segno = s ? `  ${s.toUpperCase()}` : '';
    return `- ${c.file} › ${c.caso}: senza ${c.senza}, con ${c.con}${segno}`;
  });
  const conto = `${p.casi.length} casi, ${p.verdiSenza} verdi anche senza il lavoro, ${p.nonVerdiCon} non verdi col lavoro`;
  return `${testa}${conto}\n${righe.join('\n')}`;
}

export { PROVE_APP, PROVE_SERVER };
