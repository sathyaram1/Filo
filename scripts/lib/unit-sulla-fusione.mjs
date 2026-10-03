// Gli unit test sul RISULTATO della fusione del ramo con origin/main, prima di chiederla al server (#929).
// Non fonde e non spinge niente: lavora in cartelle temporanee e le toglie senza mai attraversare il collegamento
// a node_modules. La usano scripts/merge-gate.mjs e scripts/finish-local.mjs; sentinella: tests/unit/unitSullaFusione.test.mjs.

import { spawnSync, execFileSync } from 'node:child_process';
import {
  closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sommaRiepiloghi, perLaRiga } from '../run-unit-tests.mjs';

// Il reporter è quello di QUESTI strumenti, non dell'albero provato: se l'albero lo rompesse, ogni prova uscirebbe
// «rossa anche su main» e fonderebbe tutto.
const REPORTER = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), 'riepilogo-unit.mjs')).href;

/** Quante volte si rifà la prova quando il server risponde che main si è mosso. */
export const TENTATIVI = 3;
// Ampio: in locale gli unit durano 6–20 minuti con la macchina carica. Scaduto, la prova non c'è, e lo si dice.
export const TETTO_UNIT_MS = 60 * 60 * 1000;
export const ESITI = Object.freeze(['verde', 'main_contenuto', 'rosso_anche_su_main', 'rosso_sulla_fusione', 'conflitto']);
export const TETTO_ROSSI = 40;
const MAIN = 'main';
const IDENTITA = ['-c', 'user.name=filo-prova-fusione', '-c', 'user.email=prova-fusione@filo.invalid', '-c', 'commit.gpgsign=false'];

const primaRiga = (s) => String(s || '').split(/\r?\n/).find((r) => r.trim()) || '';

/** Un test rosso in una riga che due cartelle diverse scrivono uguale. PURA. */
export function chiaveTest(r, root) {
  let file = r && r.file ? perLaRiga(String(r.file), root) : '?';
  // Fuori dalla cartella (forma corta e lunga dello stesso percorso su Windows): conta il pezzo da tests/ in poi.
  if (isAbsolute(file)) {
    const barre = file.replace(/\\/g, '/');
    const i = barre.lastIndexOf('/tests/');
    if (i >= 0) file = barre.slice(i + 1);
  }
  return `${file} › ${String((r && r.nome) ?? '?')}`;
}

/** I test rossi dalle righe del reporter del riepilogo, senza doppioni. PURA. */
export function rossiDa(righe, root) {
  const { rossi } = sommaRiepiloghi([Array.isArray(righe) ? righe : []]);
  return [...new Set(rossi.map((r) => chiaveTest(r, root)))].sort();
}

/**
 * L'esito della prova. PURA. `fusione`/`main` sono { ok, rossi }; senza `main` e con la fusione rossa risponde
 * `{ serveMain: true }`. Rosso anche su main: si fonde lo stesso (un main rotto non deve fermare tutte le fusioni),
 * salvo che la fusione rompa test che su main passano.
 */
export function decidiEsito({ contenuto = false, conflitto = null, fusione = null, main = null } = {}) {
  if (contenuto) return { esito: 'main_contenuto' };
  if (conflitto) return { esito: 'conflitto', file: Array.isArray(conflitto) ? conflitto : [] };
  if (!fusione) return { serveFusione: true };
  if (fusione.ok) return { esito: 'verde' };
  if (!main) return { serveMain: true };
  const rossiFusione = Array.isArray(fusione.rossi) ? fusione.rossi : [];
  if (main.ok) return { esito: 'rosso_sulla_fusione', rossi: rossiFusione };
  const rossiMain = Array.isArray(main.rossi) ? main.rossi : [];
  const nuovi = rossiFusione.filter((r) => !rossiMain.includes(r));
  // Solo se entrambi i lati hanno registrato i loro rossi: un runner caduto non è un elenco da confrontare.
  if (rossiFusione.length && rossiMain.length && nuovi.length) {
    return { esito: 'rosso_sulla_fusione', rossi: nuovi, rossiMain: rossiMain.length };
  }
  return { esito: 'rosso_anche_su_main', rossiMain: rossiMain.length };
}

/**
 * Il campo `provaUnit` della richiesta di fusione. PURA. null = nessun campo: la prova non si poteva fare
 * (nessun origin) e il server lo registra come uno strumento vecchio.
 */
export function campoPerIlServer(prova) {
  const p = prova || {};
  if (p.saltata) return null;
  if (p.errore) return { esito: 'non_provata', motivo: String(p.errore).slice(0, 300) };
  const out = { esito: p.esito, mainSha: String(p.mainSha || '') };
  if (p.esito === 'rosso_sulla_fusione') {
    const rossi = Array.isArray(p.rossi) ? p.rossi : [];
    out.rossi = rossi.slice(0, TETTO_ROSSI).map((r) => String(r).slice(0, 300));
    if (rossi.length > TETTO_ROSSI) out.altriRossi = rossi.length - TETTO_ROSSI;
  }
  if (p.esito === 'conflitto' && Array.isArray(p.file)) out.file = p.file.slice(0, TETTO_ROSSI).map((f) => String(f).slice(0, 300));
  return out;
}

/** Cosa si stampa dopo la prova. PURA. */
export function testoProva(prova) {
  const p = prova || {};
  const m = String(p.mainSha || '').slice(0, 8);
  if (p.saltata) return `▸ Unit sulla fusione: non provati (${p.motivo}). Il server lo registra.`;
  if (p.errore) return `▸ Unit sulla fusione: prova non riuscita (${p.errore}).`;
  switch (p.esito) {
    case 'main_contenuto': return `▸ Unit sulla fusione: il ramo contiene già main (${m}), il risultato è il ramo stesso.`;
    case 'verde': return `▸ Unit sulla fusione con main ${m}: verdi.`;
    case 'conflitto': return `▸ Unit sulla fusione con main ${m}: non provati, la fusione va in conflitto${p.file && p.file.length ? ` su ${p.file.join(', ')}` : ''}.`;
    case 'rosso_anche_su_main':
      return `▸ Unit sulla fusione con main ${m}: rossi, ma rossi anche su main da solo e senza test rotti in più. Non è colpa del ramo: si fonde.`;
    case 'rosso_sulla_fusione': {
      const rossi = Array.isArray(p.rossi) ? p.rossi : [];
      return [
        `✗ Unit sulla fusione con main ${m}: rossi, e su main da solo ${p.rossiMain ? 'questi passano' : 'sono verdi'}.`,
        ...(rossi.length ? rossi.map((r) => `    ✖ ${r}`) : ['    (nessun test rosso registrato: la causa è nell\'uscita qui sotto)']),
        ...(p.coda ? ['  Ultime righe dell\'uscita sulla fusione:', ...String(p.coda).split('\n').map((r) => `    ${r}`)] : []),
      ].join('\n');
    }
    default: return `▸ Unit sulla fusione: esito ${p.esito}.`;
  }
}

/** Esecutore git con un tetto sul tempo, come quello del cancello. */
export function gitIn(root, ms = 120000) {
  return function git(args) {
    try {
      return { ok: true, out: String(execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: ms }) || '').trim() };
    } catch (e) {
      return { ok: false, out: `${(e && e.stdout) || ''}${(e && e.stderr) || ''}`.trim() || String((e && e.message) || e) };
    }
  };
}

/**
 * Toglie il collegamento a node_modules senza attraversarlo. Su Windows `rmdir` senza /s: su una junction toglie
 * la junction, su una cartella vera piena fallisce, che è il lato sicuro. Mai una rimozione ricorsiva qui.
 */
export function togliCollegamento(p) {
  let st;
  try { st = lstatSync(p); } catch (e) {
    return e && e.code === 'ENOENT' ? { ok: true } : { ok: false, motivo: `non riesco a leggere ${p}: ${e.message}` };
  }
  if (process.platform === 'win32') {
    spawnSync('cmd', ['/d', '/c', 'rmdir', p], { stdio: 'ignore', windowsHide: true });
  } else if (st.isSymbolicLink()) {
    try { unlinkSync(p); } catch (_) { /* lo dice il controllo sotto */ }
  } else {
    return { ok: false, motivo: `${p} non è un collegamento: non lo tocco` };
  }
  try { lstatSync(p); } catch (_) { return { ok: true }; }
  return { ok: false, motivo: `non riesco a togliere il collegamento ${p}` };
}

/** Toglie una cartella di prova: prima il collegamento, poi il resto, solo se il collegamento non c'è più. */
export function chiudiAlbero(git, dir) {
  const c = togliCollegamento(join(dir, 'node_modules'));
  if (!c.ok) return c;
  if (!git(['worktree', 'remove', '--force', dir]).ok) {
    try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* resta: lo dice il controllo sotto */ }
    git(['worktree', 'prune']);
  }
  return existsSync(dir) ? { ok: false, motivo: `non riesco a togliere ${dir}` } : { ok: true };
}

/** node_modules vero del repo (nel worktree è già un collegamento: si segue fino in fondo). '' se non c'è. */
function cartellaModuli(root) {
  try { return realpathSync(join(root, 'node_modules')); } catch (_) { return ''; }
}

function apriAlbero(git, base, nome, sha, moduli) {
  const dir = join(base, nome);
  const r = git(['worktree', 'add', '--detach', '--quiet', dir, sha]);
  if (!r.ok) return { errore: `non riesco a preparare la cartella di prova (${primaRiga(r.out)})` };
  if (moduli) {
    try { symlinkSync(moduli, join(dir, 'node_modules'), 'junction'); } catch (e) {
      return { dir, errore: `non riesco a collegare node_modules nella cartella di prova (${e.message})` };
    }
  }
  return { dir };
}

function coda(file, righe = 40) {
  try { return readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).slice(-righe).join('\n'); } catch (_) { return ''; }
}

function leggiRighe(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l)]; } catch (_) { return []; }
    });
  } catch (_) { return []; }
}

/** `npm run test:unit` dell'albero provato, con l'uscita su file. { ok, rossi, coda } | { errore }. */
export function lanciaUnit(dir, base, nome, { timeoutMs = TETTO_UNIT_MS } = {}) {
  const runner = join(dir, 'scripts', 'run-unit-tests.mjs');
  if (!existsSync(runner)) return { errore: 'nell\'albero provato manca scripts/run-unit-tests.mjs' };
  const dest = join(base, `${nome}.jsonl`);
  const log = join(base, `${nome}.log`);
  const fd = openSync(log, 'w');
  // Lanciata da dentro un `node --test`, questa variabile farebbe dei test provati dei figli suoi: niente rapporti.
  const { NODE_TEST_CONTEXT: _figlio, ...env } = process.env;
  let r;
  try {
    r = spawnSync(process.execPath, [
      runner, '--test-reporter=spec', '--test-reporter-destination=stdout',
      `--test-reporter=${REPORTER}`, `--test-reporter-destination=${dest}`,
    ], { cwd: dir, env, stdio: ['ignore', fd, fd], timeout: timeoutMs, windowsHide: true });
  } finally { closeSync(fd); }
  if (r.error && r.error.code === 'ETIMEDOUT') return { errore: `unit oltre il tetto di ${Math.round(timeoutMs / 60000)} minuti` };
  if (r.error) return { errore: `non riesco a lanciare gli unit (${r.error.message})` };
  if (r.status === null) return { errore: `unit interrotti (${r.signal || 'segnale'})` };
  return { ok: r.status === 0, rossi: rossiDa(leggiRighe(dest), dir), coda: coda(log) };
}

/**
 * La prova. { esito, mainSha, rossi?, rossiMain?, file?, coda? } | { saltata, motivo } | { errore, mainSha? }.
 * `lancia` è iniettabile solo per i test.
 */
export function provaUnitSullaFusione({ root, punta, git = gitIn(root), lancia = lanciaUnit, scrivi = (s) => console.log(s), timeoutMs = TETTO_UNIT_MS } = {}) {
  const remoti = git(['remote']);
  if (!remoti.ok) return { errore: `git non risponde (${primaRiga(remoti.out)})` };
  if (!remoti.out.split(/\s+/).includes('origin')) return { saltata: true, motivo: 'nessun origin da cui prendere main' };
  const f = git(['fetch', '--quiet', 'origin', `+refs/heads/${MAIN}:refs/remotes/origin/${MAIN}`]);
  if (!f.ok) return { errore: `non riesco a scaricare main da origin (${primaRiga(f.out)})` };
  const m = git(['rev-parse', '--verify', `refs/remotes/origin/${MAIN}^{commit}`]);
  const mainSha = m.ok ? m.out.trim() : '';
  if (!/^[0-9a-f]{40}$/i.test(mainSha)) return { errore: 'non riesco a leggere lo sha di main' };
  if (!/^[0-9a-f]{40}$/i.test(String(punta || ''))) return { errore: 'punta del ramo non valida', mainSha };
  if (git(['merge-base', '--is-ancestor', mainSha, punta]).ok) return { esito: 'main_contenuto', mainSha };

  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'filo-fusione-')));
  const nessunHook = join(base, 'nessun-hook');
  mkdirSync(nessunHook);
  const moduli = cartellaModuli(root);
  const alberi = [];
  const opz = { timeoutMs };
  try {
    const a = apriAlbero(git, base, 'fusione', mainSha, moduli);
    if (a.dir) alberi.push(a.dir);
    if (a.errore) return { errore: a.errore, mainSha };
    const ga = gitIn(a.dir);
    const fusa = ga([...IDENTITA, '-c', `core.hooksPath=${nessunHook}`, 'merge', '--no-ff', '--no-edit', '--quiet', punta]);
    if (!fusa.ok) {
      const u = ga(['diff', '--name-only', '--diff-filter=U']);
      const file = u.ok ? u.out.split(/\r?\n/).filter(Boolean) : [];
      if (file.length) return { ...decidiEsito({ conflitto: file }), mainSha };
      return { errore: `fusione di prova non riuscita (${primaRiga(fusa.out)})`, mainSha };
    }
    scrivi(`▸ Unit sul risultato della fusione con main ${mainSha.slice(0, 8)} (l'uscita completa resta in una cartella temporanea)`);
    const fusione = lancia(a.dir, base, 'fusione', opz);
    if (fusione.errore) return { errore: fusione.errore, mainSha };
    let d = decidiEsito({ fusione });
    if (d.serveMain) {
      scrivi(`▸ Unit rossi sulla fusione (${fusione.rossi.length}): li riprovo su main da solo`);
      const b = apriAlbero(git, base, 'main', mainSha, moduli);
      if (b.dir) alberi.push(b.dir);
      if (b.errore) return { errore: b.errore, mainSha };
      const main = lancia(b.dir, base, 'main', opz);
      if (main.errore) return { errore: main.errore, mainSha };
      d = decidiEsito({ fusione, main });
    }
    return { ...d, mainSha, ...(d.esito === 'rosso_sulla_fusione' ? { coda: fusione.coda } : {}) };
  } finally {
    const rimasti = alberi.map((dir) => chiudiAlbero(git, dir)).filter((r) => !r.ok);
    if (rimasti.length) {
      for (const r of rimasti) console.error(`[unit sulla fusione] ${r.motivo}: cartella lasciata in ${base}. Togli prima il collegamento node_modules con \`cmd /c rmdir\` (o \`rm\` del solo collegamento), mai una rimozione ricorsiva.`);
    } else {
      try { rmSync(base, { recursive: true, force: true }); } catch (_) { /* cartella temporanea: la pulisce il sistema */ }
    }
  }
}

/**
 * Prova, chiede, e rifà la prova se il server risponde che main si è mosso, fino a `tentativi` volte.
 * `fermaSe(prova)` true = non si chiede niente (il finish locale si ferma da sé su un rosso o su una prova mancata).
 * @returns {Promise<{ prova, reply?, fermo?, tentativi, esaurito? }>}
 */
export async function chiediConProva({ root, punta, chiedi, mainMosso, fermaSe = () => false, tentativi = TENTATIVI, prova = provaUnitSullaFusione, scrivi = (s) => console.log(s) } = {}) {
  let ultima = null;
  for (let i = 1; i <= tentativi; i++) {
    ultima = prova({ root, punta, scrivi });
    scrivi(testoProva(ultima));
    if (fermaSe(ultima)) return { prova: ultima, fermo: true, tentativi: i };
    const reply = await chiedi(campoPerIlServer(ultima));
    if (!mainMosso(reply)) return { prova: ultima, reply, tentativi: i };
    if (i === tentativi) return { prova: ultima, reply, tentativi: i, esaurito: true };
    scrivi(`▸ Il server dice che main si è mosso dopo la prova${reply && reply.mainSha ? ` (adesso è ${String(reply.mainSha).slice(0, 8)})` : ''}: la rifaccio (${i + 1} di ${tentativi}).`);
  }
  return { prova: ultima, tentativi, esaurito: true };
}
