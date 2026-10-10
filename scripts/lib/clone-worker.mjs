// Un clone del repo per ogni worker in parallelo (SPEC-DOMANDE.md §12.2, #1157): cartelle di lavoro git che
// condividono la .git si contendono i lock di fetch e push. Non tocca mai il node_modules del principale (collegato,
// tolto prima della cartella). Unit test: tests/unit/cloneWorker.test.mjs. Comando: scripts/clone-worker.mjs.

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { ensureSessionExcludes } from './branch-integrity.mjs';
import { MARCATORE_WORKER } from './dati-worker.mjs';
import { pinWorkerTools, pinnedDirWorker, TOOLS_ROOT } from './tools-pin.mjs';

export { MARCATORE_WORKER, datiWorker, concorrenzaUnit } from './dati-worker.mjs';
export const REGISTRO = 'filo-cloni';

/** Dove nascono i clone: fuori dal progetto, per costruzione. `FILO_CLONI_DIR` per i test. */
export function baseCloni(env = process.env) {
  const scelta = String(env.FILO_CLONI_DIR || '').trim();
  return scelta ? resolve(scelta) : resolve(tmpdir(), 'filo-lavori');
}

export function indiceWorker(n) {
  const i = Number(n);
  if (!Number.isInteger(i) || i < 1 || i > 99) throw new Error(`indice del worker non valido: ${n} (da 1 a 99)`);
  return i;
}

/** Due URL di origin sono lo stesso remoto? Maiuscole, `.git` e barra finale non contano. PURA. */
export function stessoRemoto(a, b) {
  const n = (u) => String(u || '').trim().replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  return !!n(a) && n(a) === n(b);
}

// Le chiavi locali che servono a scaricare e spedire (in cloud stanno nella config del repo, non in quella globale).
const CHIAVE_ACCESSO = /^(credential\..*|http\..*|url\..*\.(insteadof|pushinsteadof)|core\.sshcommand)$/i;

/** Le voci `chiave\nvalore\0` di `git config --null --get-regexp`, solo quelle d'accesso. PURA. */
export function chiaviAccesso(uscitaNull) {
  return String(uscitaNull || '').split('\0').filter(Boolean).map((voce) => {
    const a = voce.indexOf('\n');
    return a < 0 ? [voce, ''] : [voce.slice(0, a), voce.slice(a + 1)];
  }).filter(([k]) => CHIAVE_ACCESSO.test(k));
}

function gitIn(cwd, args, { env } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  return { ok: r.status === 0, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
}

/** Dove il principale tiene l'elenco dei suoi clone: dentro la sua .git, quindi mai in un commit. */
export function cartellaRegistro(principale) {
  const c = gitIn(principale, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return c.ok && c.out ? resolve(c.out, REGISTRO) : '';
}

export function elencoCloni(principale) {
  const dir = cartellaRegistro(principale);
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^\d+$/.test(n)).map((n) => {
    let cartella = '';
    try { cartella = readFileSync(resolve(dir, n), 'utf8').split('\n')[0].trim(); } catch (_) { /* voce illeggibile */ }
    return { indice: Number(n), cartella, esiste: !!cartella && existsSync(cartella) };
  }).sort((a, b) => a.indice - b.indice);
}

const esisteLink = (p) => { try { lstatSync(p); return true; } catch (_) { return false; } };
const eLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch (_) { return false; } };

/** Mai ricorsivo: si toglie il collegamento, non quello a cui punta (una junction attraversata svuota il principale). */
export function scollega(link) {
  if (!eLink(link)) return false;
  if (process.platform === 'win32') rmdirSync(link);
  else unlinkSync(link);
  return true;
}

function collega(verso, link) {
  symlinkSync(verso, link, process.platform === 'win32' ? 'junction' : 'dir');
}

// node_modules del clone è una cartella vera con un collegamento per ogni pacchetto del principale, non un collegamento
// solo: `npm ci` svuota la cartella entrando nel collegamento, e così toglie i collegamenti invece dei pacchetti di tutti.
export const MARCA_COLLEGATI = '.filo-collegati';
const collegatiVoceAVoce = (nm) => existsSync(resolve(nm, MARCA_COLLEGATI));

function collegaVoci(verso, nm) {
  mkdirSync(nm, { recursive: true });
  for (const voce of readdirSync(verso, { withFileTypes: true })) {
    const da = resolve(verso, voce.name);
    let cartella = voce.isDirectory();
    if (voce.isSymbolicLink()) { try { cartella = statSync(da).isDirectory(); } catch (_) { continue; } }
    if (cartella) collega(da, resolve(nm, voce.name)); // i file (.package-lock.json) npm li ricostruisce da sé
  }
  writeFileSync(resolve(nm, MARCA_COLLEGATI), `${verso}\n`, 'utf8');
}

/** Toglie i collegamenti del node_modules di un clone, uno per uno; anche quello intero dei clone nati prima. */
export function scollegaPacchetti(nm) {
  if (scollega(nm) || !existsSync(nm)) return;
  for (const nome of readdirSync(nm)) scollega(resolve(nm, nome));
  rmSync(resolve(nm, MARCA_COLLEGATI), { force: true });
}

const restaUnCollegamento = (nm) => eLink(nm) || (existsSync(nm) && readdirSync(nm).some((n) => eLink(resolve(nm, n))));

function npmCiDavvero(cartella) {
  const env = { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' };
  const ci = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: cartella, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (ci.status !== 0) return { ok: false, why: `npm ci uscito con ${ci.status}` };
  const el = resolve(cartella, 'scripts', 'ensure-electron.mjs');
  if (existsSync(el)) {
    const r = spawnSync(process.execPath, [el], { cwd: cartella, stdio: 'inherit' });
    if (r.status !== 0) return { ok: false, why: `ensure-electron uscito con ${r.status}` };
  }
  return { ok: true, why: '' };
}

const leggi = (f) => { try { return readFileSync(f, 'utf8'); } catch (_) { return null; } };
// I fine riga non cambiano i pacchetti: un checkout con autocrlf non deve costare un'installazione.
const lock = (dir) => { const t = leggi(resolve(dir, 'package-lock.json')); return t === null ? null : t.replace(/\r\n/g, '\n'); };

/**
 * `node_modules` del clone: collegato pacchetto per pacchetto a quello del principale se `package-lock.json` è lo
 * stesso da cui il principale ha installato; altrimenti un'installazione privata (la cache di npm resta condivisa).
 * Da richiamare dopo che il clone è sul ramo del lavoro.
 */
export function allineaPacchetti(clone, principale, { npmCi = npmCiDavvero } = {}) {
  const nm = resolve(clone, 'node_modules');
  const lockClone = lock(clone);
  const lockPrincipale = lock(principale);
  if (lockClone !== null && lockClone === lockPrincipale) {
    if (!existsSync(resolve(principale, 'node_modules'))) return { ok: false, pacchetti: '', why: 'il principale non ha node_modules' };
    // Ogni volta da capo: il principale può aver aggiunto o tolto pacchetti da allora.
    scollegaPacchetti(nm);
    if (restaUnCollegamento(nm)) return { ok: false, pacchetti: '', why: 'un collegamento a node_modules non si toglie: mi fermo' };
    rmSync(nm, { recursive: true, force: true }); // un'installazione privata rimasta da un ramo prima
    // Al bersaglio vero: il node_modules di un worktree è già un collegamento a quello del principale.
    collegaVoci(realpathSync(resolve(principale, 'node_modules')), nm);
    return { ok: true, pacchetti: 'collegati', why: '' };
  }
  const daCollegati = eLink(nm) || collegatiVoceAVoce(nm);
  scollegaPacchetti(nm);
  if (restaUnCollegamento(nm)) return { ok: false, pacchetti: '', why: 'un collegamento a node_modules non si toglie: mi fermo' };
  if (daCollegati) rmSync(nm, { recursive: true, force: true });
  const r = npmCi(clone);
  return r.ok ? { ok: true, pacchetti: 'privati', why: '' } : { ok: false, pacchetti: '', why: r.why };
}

/**
 * Prepara (o riprende) il clone del worker `n`: `git clone --reference-if-able <principale> --dissociate <origin>`,
 * controllo che `origin` sia quello del principale, chiavi d'accesso copiate senza stamparle, pacchetti, marcatore,
 * voce nel registro, strumenti per worker. `pushUrl` e `registra: false` (solo la misura di K) mandano i push su un
 * repo nudo locale e lasciano il registro ai worker veri.
 */
export function preparaClone(principale, n, {
  base = baseCloni(), dest = '', paralleli = 0, pushUrl = '', strumentiDa = TOOLS_ROOT, basePin, npmCi, registra = true,
} = {}) {
  let i;
  try { i = indiceWorker(n); } catch (e) { return { ok: false, why: e.message }; }
  const radice = resolve(principale);
  const dir = resolve(dest || resolve(base, String(i)));
  const url = gitIn(radice, ['remote', 'get-url', 'origin']).out;
  if (!url) return { ok: false, why: 'il principale non ha un origin: non saprei dove spedire' };

  const accesso = chiaviAccesso(gitIn(radice, ['config', '--local', '--null', '--get-regexp', '.']).out);
  // Le chiavi passano a git dall'ambiente, mai dalla riga di comando (che si legge nell'elenco dei processi).
  const envAccesso = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: String(accesso.length) };
  accesso.forEach(([k, v], j) => { envAccesso[`GIT_CONFIG_KEY_${j}`] = k; envAccesso[`GIT_CONFIG_VALUE_${j}`] = v; });

  if (existsSync(dir)) {
    const suo = existsSync(resolve(dir, MARCATORE_WORKER)) && stessoRemoto(gitIn(dir, ['remote', 'get-url', 'origin']).out, url);
    if (!suo) return { ok: false, why: `${dir} esiste e non è un clone di worker di questo progetto: non lo tocco` };
    const f = gitIn(dir, ['fetch', '--quiet', 'origin'], { env: envAccesso });
    if (!f.ok) return { ok: false, why: `fetch nel clone fallito: ${f.err.split('\n')[0]}` };
  } else {
    mkdirSync(dirname(dir), { recursive: true });
    // Da un principale poco profondo git rifiuta di prendere gli oggetti in prestito: lì si scarica tutto.
    const comune = gitIn(radice, ['rev-parse', '--path-format=absolute', '--git-common-dir']).out;
    const shallow = gitIn(radice, ['rev-parse', '--is-shallow-repository']).out === 'true';
    const prestito = comune && !shallow ? ['--reference-if-able', comune, '--dissociate'] : [];
    const c = gitIn(dirname(dir), ['clone', '--quiet', ...prestito, url, dir], { env: envAccesso });
    if (!c.ok) {
      rmSync(dir, { recursive: true, force: true });
      return { ok: false, why: `git clone fallito: ${c.err.split('\n').filter((l) => !/^warning/i.test(l))[0] || ''}` };
    }
    for (const [k, v] of accesso) gitIn(dir, ['config', '--local', '--add', k, v]);
  }

  // Un origin sbagliato spedirebbe in silenzio da un'altra parte (per esempio nella cartella del principale).
  const originClone = gitIn(dir, ['remote', 'get-url', 'origin']).out;
  if (!stessoRemoto(originClone, url)) {
    return { ok: false, why: `l'origin del clone (${originClone || 'nessuno'}) non è quello del principale: non lo uso` };
  }
  if (pushUrl) gitIn(dir, ['remote', 'set-url', '--push', 'origin', pushUrl]);

  const pacchetti = allineaPacchetti(dir, radice, npmCi ? { npmCi } : {});
  if (!pacchetti.ok) return { ok: false, dir, why: pacchetti.why };

  mkdirSync(resolve(dir, '.claude'), { recursive: true });
  writeFileSync(resolve(dir, MARCATORE_WORKER), `${JSON.stringify({ indice: i, paralleli: Number(paralleli) || 0, principale: radice })}\n`, 'utf8');
  ensureSessionExcludes(dir);

  const registro = registra ? cartellaRegistro(radice) : '';
  if (registro) {
    mkdirSync(registro, { recursive: true });
    writeFileSync(resolve(registro, String(i)), `${dir}\n`, 'utf8');
  }

  const pin = pinWorkerTools(dir, i, { da: strumentiDa, ...(basePin ? { base: basePin } : {}) });
  if (!pin.ok) return { ok: false, dir, why: `strumenti del worker non copiati: ${pin.why}` };
  return { ok: true, dir, strumenti: pin.dir, pacchetti: pacchetti.pacchetti, why: '' };
}

const stessaCartella = (a, b) => {
  const n = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  return !!a && !!b && n(a) === n(b);
};

/**
 * Toglie il clone del worker `n`: prima il collegamento a node_modules, poi la cartella, la voce e gli strumenti. La
 * voce del registro se ne va solo se è di quella cartella: un `dest` altrui non cancella il worker vero col suo numero.
 */
export function togliClone(principale, n, { base = baseCloni(), dest = '', basePin, registra = true } = {}) {
  let i;
  try { i = indiceWorker(n); } catch (e) { return { ok: false, why: e.message }; }
  const registro = registra ? cartellaRegistro(resolve(principale)) : '';
  const voce = registro ? resolve(registro, String(i)) : '';
  const daRegistro = voce ? String(leggi(voce) || '').split('\n')[0].trim() : '';
  const dir = resolve(dest || daRegistro || resolve(base, String(i)));
  if (existsSync(dir)) {
    if (!existsSync(resolve(dir, MARCATORE_WORKER))) return { ok: false, dir, why: `${dir} non ha il marcatore del worker: non lo tolgo` };
    scollegaPacchetti(resolve(dir, 'node_modules'));
    if (restaUnCollegamento(resolve(dir, 'node_modules'))) return { ok: false, dir, why: 'un collegamento a node_modules non si toglie: mi fermo prima della cartella' };
    rmSync(dir, { recursive: true, force: true });
  }
  if (voce && (!daRegistro || stessaCartella(daRegistro, dir))) rmSync(voce, { force: true });
  const strumenti = pinnedDirWorker(i, ...(basePin ? [basePin] : []));
  const marca = String(leggi(resolve(strumenti, '.filo-repo-root')) || '').trim();
  if (marca && resolve(marca) === dir) rmSync(strumenti, { recursive: true, force: true });
  return { ok: true, dir, why: '' };
}

