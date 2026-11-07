// dichiara-spinte.mjs — le spinte col biglietto di chi spinge (#1362). `--pre-push <app|server> <radice> [<url>]` accoda i
// commit nati qui, ognuno col biglietto di chi l'ha fatto (la traccia la scrivono `--post-commit`, `--post-merge` e
// `--post-rewrite`), e lancia l'invio; non ferma mai git. `--invia <radice>`: la coda al server. Regole: lib/spinte.mjs.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './lib/spinte.mjs';

const QUI = fileURLToPath(import.meta.url);
// Il checkout di Filo di questo script: lì vivono i biglietti locali anche quando spinge il clone di filo-security.
const FILO = resolve(dirname(QUI), '..');
// L'invio in sottofondo aspetta un attimo: le spinte di un salvataggio dopo l'altro partono insieme.
const ATTESA_INVIO_MS = 2000;

async function leggiStdin() {
  if (process.stdin.isTTY) return '';
  const pezzi = [];
  for await (const p of process.stdin) pezzi.push(p);
  return Buffer.concat(pezzi).toString('utf8');
}

function origine(radice) {
  try {
    return execFileSync('git', ['remote', 'get-url', '--push', 'origin'], { cwd: radice, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return '';
  }
}

/** Il pre-push: accoda e lancia l'invio. → quante spinte ha accodato. Mai un'eccezione verso git. */
export async function prePush({ repo, radice, url = '', righe, env = process.env, lanciaInvio = lancia } = {}) {
  if (repo !== 'app' && repo !== 'server') return 0;
  // Dove va la spinta lo dice git (il secondo argomento del pre-push); senza, l'origin.
  if (!S.origineDelRegistro(url || origine(radice), repo)) return 0;
  const chi = S.chiSpinge({ root: repo === 'server' ? FILO : radice, env });
  if (!chi) return 0;
  const spinte = S.spinteDelPrePush(radice, righe);
  let n = 0;
  for (const g of S.perAutore(radice, chi, spinte)) n += S.accoda(radice, g.chi, repo, g.spinte);
  if (n && !env.FILO_SPINTE_SENZA_INVIO) lanciaInvio(radice, env);
  return n;
}

const gitIn = (radice, args) => execFileSync('git', args, { cwd: radice, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim();

/**
 * Da quali commit viene `sha`, se è una copia: null = nato adesso, [] = una copia di cui non si trova l'originale. Un
 * rebase e un amend li porta il post-rewrite, che sa da quale commit viene ogni copia.
 */
export function originaliDi(radice, sha) {
  const gitDir = resolve(radice, gitIn(radice, ['rev-parse', '--git-dir']));
  if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))) return null;
  if (/^commit \(amend\)/.test(gitIn(radice, ['reflog', '-1', '--format=%gs', 'HEAD']))) return null;
  try { return [gitIn(radice, ['rev-parse', '--verify', '--quiet', 'CHERRY_PICK_HEAD^{commit}'])]; } catch (_) { /* finito, o non c'era */ }
  const [an, ae, at, cn, ce, ct, oggetto] = gitIn(radice, ['show', '-s', '--format=%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s', sha]).split('\u0000');
  const scelto = /^commit \(cherry-pick\)/.test(gitIn(radice, ['reflog', '-1', '--format=%gs', 'HEAD']));
  if (!scelto && an === cn && ae === ce && at === ct) return null;
  // Ha tenuto autore e messaggio di un altro commit (un cherry-pick chiuso dopo un conflitto, commit -c): è quello.
  const righe = gitIn(radice, ['log', '--all', '--reflog', '-F', `--author=${ae}`, '--format=%H%x00%an%x00%ae%x00%at%x00%s']).split('\n');
  const uguali = righe.map((r) => r.split('\u0000')).filter(([h, n, e, t, o]) => h !== sha && n === an && e === ae && t === at && o === oggetto);
  return [...new Set(uguali.map(([h]) => h))];
}

/** Chi fa un commit in `radice`: per filo-security i biglietti stanno nel checkout di Filo di questo script. */
const chiQui = (radice, repo, env) => S.chiSpinge({ root: repo === 'server' ? FILO : radice, env });

/** Il post-commit: HEAD è nato qui, da chi (anche nessuna sessione), e una copia porta la traccia del suo originale. */
export function postCommit({ radice, repo = 'app', env = process.env } = {}) {
  try {
    const sha = gitIn(radice, ['rev-parse', 'HEAD']);
    let originali = null;
    try { originali = originaliDi(radice, sha); } catch (_) { originali = []; }
    return S.annotaAutore(radice, chiQui(radice, repo, env), sha, Date.now(), { originali });
  } catch (_) {
    return false;
  }
}

/**
 * Il post-merge: una fusione che ha fatto un commit lo annota come nato qui. Un avanzamento veloce no: porta commit
 * nati altrove. Mai un'eccezione verso git.
 */
export function postMerge({ radice, repo = 'app', env = process.env } = {}) {
  try {
    const [sha, ...genitori] = gitIn(radice, ['rev-list', '--parents', '-n1', 'HEAD']).split(/\s+/);
    const prima = gitIn(radice, ['rev-parse', '--verify', '--quiet', 'HEAD@{1}']);
    if (genitori.length < 2 || genitori[0] !== prima) return false;
    if (/fast-forward/i.test(gitIn(radice, ['reflog', '-1', '--format=%gs', 'HEAD']))) return false;
    return S.annotaAutore(radice, chiQui(radice, repo, env), sha);
  } catch (_) {
    return false;
  }
}

/** Il post-rewrite: la copia di un rebase o di un amend porta anche gli autori dell'originale. Mai un'eccezione verso git. */
export function postRewrite({ radice, righe } = {}) {
  try {
    return S.ereditaAutori(radice, righe);
  } catch (_) {
    return 0;
  }
}

function lancia(radice, env) {
  const figlio = spawn(process.execPath, [QUI, '--invia', radice, '--attendi', String(ATTESA_INVIO_MS)], {
    detached: true, stdio: 'ignore', env, windowsHide: true,
  });
  figlio.unref();
}

async function main(argv) {
  const [modo, a, b, ...resto] = argv;
  if (modo === '--pre-push') {
    await prePush({ repo: a, radice: resolve(b || process.cwd()), url: resto[0] || '', righe: await leggiStdin() });
    return 0;
  }
  if (modo === '--post-commit') {
    postCommit({ radice: resolve(a || process.cwd()), repo: b === 'server' ? 'server' : 'app' });
    return 0;
  }
  if (modo === '--post-merge') {
    postMerge({ radice: resolve(a || process.cwd()), repo: b === 'server' ? 'server' : 'app' });
    return 0;
  }
  if (modo === '--post-rewrite') {
    postRewrite({ radice: resolve(a || process.cwd()), righe: await leggiStdin() });
    return 0;
  }
  if (modo === '--invia') {
    const i = resto.indexOf('--attendi');
    const attendiMs = b === '--attendi' ? Number(resto[0]) || 0 : i >= 0 ? Number(resto[i + 1]) || 0 : 0;
    const r = await S.inviaSpinte({ root: resolve(a || process.cwd()), deps: attendiMs ? { attendiMs } : {} });
    const riga = S.rigaSpinte(r);
    if (riga) console.error(riga);
    return 0;
  }
  console.error('Uso: node scripts/dichiara-spinte.mjs --pre-push <app|server> <radice> [<url>] | --post-commit <radice> [app|server] | --post-merge <radice> [app|server] | --post-rewrite <radice> | --invia <radice>');
  return 2;
}

const lanciato = (() => { try { return realpathSync(process.argv[1]); } catch (_) { return resolve(process.argv[1] || ''); } })();
if (process.argv[1] && lanciato === QUI) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`dichiara-spinte: ${String((e && e.message) || e)}`);
    // Un guasto qui non ferma mai un push: le spinte non accodate restano di nessuno, cioè buco al controllo.
    process.exitCode = 0;
  });
}
