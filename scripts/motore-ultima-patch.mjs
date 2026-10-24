// motore-ultima-patch.mjs — Electron nel lockfile è indietro rispetto all'ultima patch stabile della sua major? Apre un feedback.
// Avvisa e non ferma: rete giù o risposta di npm illeggibile lasciano un avviso nel registro ed escono 0. Solo moduli di Node.
// Regole: patterns/il-motore-si-tiene-fra-le-ultime-tre-major-di-electron.md; sentinella tests/unit/motoreUltimaPatch.test.mjs.

import { execFile } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spedisciAllarme } from './build-alarm.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSIONE = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/;

/** [major, minor, patch, anteprima] o null. PURA. */
function parti(versione) {
  const m = VERSIONE.exec(String(versione || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Boolean(m[4])] : null;
}

/** Negativo se `a` viene prima di `b`; un'anteprima viene prima della stabile con lo stesso numero. PURA. */
function confrontaVersioni(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return Number(b[3]) - Number(a[3]);
}

/** La versione di Electron che il lockfile installa, o null. PURA. */
export function versioneDelLockfile(lock) {
  const v = lock?.packages?.['node_modules/electron']?.version;
  return typeof v === 'string' && parti(v) ? v : null;
}

/** Cosa chiedere a npm: le versioni pubblicate della major, in JSON. PURA. */
export const argomentiNpm = (major) => ['view', `electron@${Number(major)}`, 'version', '--json'];

/**
 * Le versioni dalla risposta di `npm view … version --json`: una stringa se la major ne ha una sola, un elenco se ne ha
 * di più. Vuota, non JSON o d'altra forma (un errore di npm è un oggetto) → null. PURA.
 */
export function leggiPubblicate(risposta) {
  let dato;
  try { dato = JSON.parse(String(risposta ?? '').trim()); } catch { return null; }
  if (typeof dato === 'string') return [dato];
  if (Array.isArray(dato)) return dato.filter((v) => typeof v === 'string');
  return null;
}

/**
 * Le stabili della major del lockfile (niente alpha, beta, nightly, niente altre major) e l'ultima fra loro.
 * Null se il lockfile non è leggibile o la risposta non ha nessuna stabile di quella major: senza confronto, niente
 * allarme. PURA.
 */
export function confronta(versioneLock, pubblicate) {
  const lock = parti(versioneLock);
  if (!lock || !Array.isArray(pubblicate)) return null;
  const stabili = pubblicate.map(parti).filter((p) => p && !p[3] && p[0] === lock[0]).sort(confrontaVersioni);
  if (!stabili.length) return null;
  const ultima = stabili[stabili.length - 1];
  return {
    major: lock[0],
    attuale: String(versioneLock).trim(),
    ultima: ultima.slice(0, 3).join('.'),
    indietro: confrontaVersioni(lock, ultima) < 0,
  };
}

/** Una chiave per major: un allarme aperto assorbe le patch che escono dopo, la major successiva ne apre uno suo. PURA. */
export const chiaveDelMotore = (major) => `motore:electron-${Number(major)}`;

/** Titolo, testo e chiavi del feedback. PURA. */
export function allarme({ major, attuale, ultima }) {
  const titolo = `Electron ${ultima} è uscita e Filo è ancora sulla ${attuale}`;
  const testo = [
    `Il lockfile fissa Electron alla ${attuale}, e l'ultima ${major}.x stabile pubblicata è la ${ultima}. Le correzioni `
      + 'di sicurezza di Chromium arrivano nelle patch di Electron, e ogni versione di Filo esce col motore del lockfile '
      + 'finché qualcuno non lo alza.',
    '',
    'Da fare:',
    `1. Portare il lockfile all'ultima ${major}.x stabile del momento (\`npm view electron@${major} version --json\`; `
      + `all'allarme era la ${ultima}): \`npm install --save-dev electron@${ultima}\`. In cloud il binario arriva con `
      + '`node scripts/ensure-electron.mjs`.',
    '2. Leggere i cambi fra le due versioni e lanciare gli spec delle aree che toccano, come dice '
      + '`patterns/il-motore-si-tiene-fra-le-ultime-tre-major-di-electron.md` (sezione «Le patch della stessa major»).',
    '',
    `Lo apre \`scripts/motore-ultima-patch.mjs\`, ogni sei ore, dal lavoro «scegli» della pubblicazione. Finché questo `
      + `feedback è aperto, le altre patch della ${major} non ne aprono un secondo.`,
  ].join('\n');
  return { titolo, testo, chiavi: [chiaveDelMotore(major)] };
}

/** Le versioni pubblicate della major, chieste a npm con un tetto di tempo. */
export function leggiDaNpm(major, { timeout = 120_000 } = {}) {
  return new Promise((fatto, fallito) => {
    // Su Windows `npm` è un .cmd e Node non lo lancia senza shell; gli argomenti sono fissi, la major è un numero.
    execFile('npm', argomentiNpm(major), { shell: process.platform === 'win32', timeout, maxBuffer: 8 * 1024 * 1024 },
      (errore, stdout) => (errore ? fallito(errore) : fatto(String(stdout))));
  });
}

const messaggio = (e) => String((e && (e.message || e)) || 'errore senza messaggio').split('\n')[0].slice(0, 300);

/**
 * Il controllo intero, con lettore e allarme passati da fuori. Esce 0 in pari e su ogni dubbio (rete, risposta
 * illeggibile); 1 solo se è indietro e l'allarme non è arrivato, così il passo lo mostra.
 */
export async function controlla({ lock, leggi = leggiDaNpm, avvisa = spedisciAllarme, log = console.log } = {}) {
  const attuale = versioneDelLockfile(lock);
  if (!attuale) {
    log('::warning::[motore] package-lock.json non dice quale Electron installa: controllo delle patch saltato.');
    return 0;
  }
  const [major] = parti(attuale);
  let risposta;
  try {
    risposta = await leggi(major);
  } catch (e) {
    log(`::warning::[motore] npm non ha detto le versioni di Electron ${major} (${messaggio(e)}): nessun allarme in questa corsa, si riprova alla prossima.`);
    return 0;
  }
  const esito = confronta(attuale, leggiPubblicate(risposta));
  if (!esito) {
    log(`::warning::[motore] la risposta di npm sulle versioni di Electron ${major} non si legge («${String(risposta ?? '').trim().slice(0, 120)}»): nessun allarme in questa corsa.`);
    return 0;
  }
  if (!esito.indietro) {
    log(`[motore] Electron ${attuale} è l'ultima ${major}.x stabile: in pari.`);
    return 0;
  }
  log(`::warning::[motore] Electron ${attuale} è indietro: l'ultima ${major}.x stabile è la ${esito.ultima}.`);
  const { titolo, testo, chiavi } = allarme(esito);
  return (await avvisa(titolo, testo, chiavi)) ? 0 : 1;
}

async function main() {
  let lock;
  try {
    lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  } catch (e) {
    console.log(`::warning::[motore] package-lock.json non si legge (${messaggio(e)}): controllo delle patch saltato.`);
    return 0;
  }
  return controlla({ lock });
}

// Lanciato da una copia dietro un collegamento i due percorsi non combacerebbero e lo script tacerebbe (#733).
const stessoFile = (a, b) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
};
if (process.argv[1] && stessoFile(process.argv[1], fileURLToPath(import.meta.url))) process.exitCode = await main();
