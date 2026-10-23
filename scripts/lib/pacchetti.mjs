// I pacchetti che package-lock.json chiede e node_modules non ha: chi avvia Filo dai sorgenti, o lancia le prove, li
// installa prima (#1572), mai fermandosi e mai sostituendo un Electron acceso. Sentinella: tests/unit/pacchetti.test.mjs.

import { closeSync, existsSync, openSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

export const PERCORSO_ELECTRON = 'node_modules/electron';
// Un'installazione da zero su una linea lenta sta sotto i cinque minuti; il tetto serve solo a non restare appesi.
export const TETTO_INSTALLAZIONE_MS = 15 * 60_000;
const ELENCO_MAX = 6;

const leggiJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch (_) { return null; } };

/** Come npm legge `os` e `cpu`: i valori ammessi, o quelli esclusi col `!` davanti. PURA. */
export function ammesso(elenco, valore) {
  if (!Array.isArray(elenco) || !elenco.length) return true;
  if (elenco.includes(`!${valore}`)) return false;
  const ammessi = elenco.filter((x) => !String(x).startsWith('!'));
  return !ammessi.length || ammessi.includes(valore);
}

/** Le voci del lock che su questa macchina devono esserci: le facoltative npm le salta da sé dove non servono. PURA. */
export function vociRichieste(lock, { platform = process.platform, arch = process.arch } = {}) {
  const pacchetti = lock && typeof lock === 'object' ? lock.packages : null;
  if (!pacchetti || typeof pacchetti !== 'object') return [];
  const voci = [];
  for (const [percorso, v] of Object.entries(pacchetti)) {
    if (!percorso.startsWith('node_modules/') || !v || typeof v !== 'object') continue;
    if (v.link || v.optional || v.devOptional) continue;
    if (!ammesso(v.os, platform) || !ammesso(v.cpu, arch)) continue;
    const nome = v.name || percorso.slice(percorso.lastIndexOf('node_modules/') + 'node_modules/'.length);
    voci.push({ percorso, nome, versione: typeof v.version === 'string' ? v.version : null });
  }
  return voci;
}

/** Da dove Node risolve i pacchetti di `radice`: la prima cartella, salendo, che ha un node_modules. */
export function baseDeiPacchetti(radice) {
  for (let d = resolve(radice); ; d = dirname(d)) {
    if (existsSync(join(d, 'node_modules'))) return d;
    if (dirname(d) === d) return null;
  }
}

/** Le voci richieste che mancano o hanno un'altra versione, con quella trovata. */
export function pacchettiDaInstallare(radice, opzioni) {
  const voci = vociRichieste(leggiJson(join(radice, 'package-lock.json')), opzioni);
  if (!voci.length) return [];
  const base = baseDeiPacchetti(radice);
  const mancanti = [];
  for (const v of voci) {
    const pj = base ? leggiJson(join(base, v.percorso, 'package.json')) : null;
    const trovata = pj && typeof pj.version === 'string' ? pj.version : null;
    if (pj && (!v.versione || trovata === v.versione)) continue;
    mancanti.push({ ...v, trovata });
  }
  return mancanti;
}

/** PURA. */
export function descrivi(voci) {
  const nomi = voci.slice(0, ELENCO_MAX).map((v) => (v.versione ? `${v.nome} ${v.versione}` : v.nome));
  const altri = voci.length - nomi.length;
  return altri > 0 ? `${nomi.join(', ')} e altri ${altri}` : nomi.join(', ');
}

/** Su Windows un eseguibile acceso non si apre in scrittura, e npm che lo sostituisce si ferma a metà lasciandolo rotto. */
export function electronInUso(base, { platform = process.platform, apri = openSync, chiudi = closeSync } = {}) {
  if (platform === 'win32') {
    const cartella = join(base, 'node_modules', 'electron');
    let nome = 'electron.exe';
    try { nome = readFileSync(join(cartella, 'path.txt'), 'utf8').trim() || nome; } catch (_) { /* il binario non c'è ancora */ }
    const exe = join(cartella, 'dist', nome);
    if (!existsSync(exe)) return false;
    try {
      chiudi(apri(exe, 'r+'));
      return false;
    } catch (e) {
      return ['EBUSY', 'EPERM', 'EACCES'].includes(e && e.code);
    }
  } else {
    // Mac e Linux sostituiscono un file aperto senza errori: il processo acceso tiene la sua copia.
    return false;
  }
}

/** `--no-save`: il lock è quello del ramo e non si riscrive. Il binario di Electron lo scarica il primo avvio. */
export function npmInstall(radice) {
  const r = spawnSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--prefer-offline'], {
    cwd: radice, stdio: 'inherit', shell: process.platform === 'win32', timeout: TETTO_INSTALLAZIONE_MS,
  });
  return { codice: r.status === null ? 1 : r.status, errore: r.error ? String(r.error.message || r.error) : '' };
}

// Fuori da node_modules: crearlo per il blocco cambierebbe da dove un worktree risolve i pacchetti.
export function fileBlocco(radice, cartella = tmpdir()) {
  const impronta = createHash('sha1').update(resolve(radice)).digest('hex').slice(0, 16);
  return join(cartella, `filo-pacchetti-${impronta}.lock`);
}

function prendiBlocco(f, ora) {
  try { closeSync(openSync(f, 'wx')); return true; } catch (e) { if (!e || e.code !== 'EEXIST') throw e; }
  // Più vecchio del tetto: è di un avvio morto a metà.
  try { if (ora() - statSync(f).mtimeMs <= TETTO_INSTALLAZIONE_MS) return false; } catch (_) { /* appena tolto */ }
  rmSync(f, { force: true });
  try { closeSync(openSync(f, 'wx')); return true; } catch (_) { return false; }
}

const dormi = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** `{ esito, mancanti }`, esito fra allineati, installati, rimandati e non riuscita. Non lancia mai. */
export function allineaPacchetti(radice, {
  installa = npmInstall, inUso = electronInUso, log = console.log, prefisso = '[pacchetti]', opzioni,
  cartellaBlocchi = tmpdir(), ora = Date.now, attendi = dormi,
} = {}) {
  let blocco = '';
  try {
    let mancanti = pacchettiDaInstallare(radice, opzioni);
    if (!mancanti.length) return { esito: 'allineati', mancanti };
    // Due avvii in fretta (il doppio clic) non devono installare insieme nello stesso node_modules.
    const f = fileBlocco(radice, cartellaBlocchi);
    if (!prendiBlocco(f, ora)) {
      log(`${prefisso} Un altro avvio sta installando i pacchetti: aspetto che finisca.`);
      for (const fine = ora() + TETTO_INSTALLAZIONE_MS; existsSync(f) && ora() < fine;) attendi(500);
      mancanti = pacchettiDaInstallare(radice, opzioni);
      if (!mancanti.length) return { esito: 'allineati', mancanti };
      if (!prendiBlocco(f, ora)) {
        log(`${prefisso} Mancano ${descrivi(mancanti)}, e l'altro avvio non ha ancora finito: Filo parte lo stesso.`);
        return { esito: 'rimandati', mancanti };
      }
    }
    blocco = f;
    const base = baseDeiPacchetti(radice);
    // Senza un node_modules suo, npm installa in `radice` e l'Electron della cartella sopra resta com'è.
    const suoElectron = base === resolve(radice) && mancanti.some((v) => v.percorso === PERCORSO_ELECTRON);
    if (suoElectron && inUso(base)) {
      log(`${prefisso} Da installare: ${descrivi(mancanti)}. Electron è ancora acceso (Filo o una prova aperti): chiudilo e riavvia Filo, li installo allora.`);
      return { esito: 'rimandati', mancanti };
    }
    log(`${prefisso} Installo i pacchetti nuovi: ${descrivi(mancanti)}.`);
    const r = installa(radice) || {};
    const restano = pacchettiDaInstallare(radice, opzioni);
    if (r.codice === 0 && !restano.length) {
      log(`${prefisso} Pacchetti installati.`);
      return { esito: 'installati', mancanti: [] };
    }
    const perche = r.codice === 0 ? 'npm ha finito' : (r.errore || `npm è uscito con ${r.codice}`);
    log(`${prefisso} Installazione non riuscita (${perche})${restano.length ? `, mancano ancora: ${descrivi(restano)}` : ''}. Filo parte lo stesso; riprovo al prossimo avvio.`);
    return { esito: 'non riuscita', mancanti: restano };
  } catch (e) {
    log(`${prefisso} Controllo dei pacchetti saltato: ${e && e.message ? e.message : e}.`);
    return { esito: 'non riuscita', mancanti: [] };
  } finally {
    if (blocco) { try { rmSync(blocco, { force: true }); } catch (_) { /* lo toglie il tetto */ } }
  }
}

/**
 * Prima delle prove: si allinea la cartella che POSSIEDE il node_modules da cui Node risolve (anche attraverso un
 * collegamento), mai un'installazione intera in un worktree o nella cartella di prova di finish. Non lancia mai.
 */
export function allineaPerLeProve(radice, { allinea = allineaPacchetti, log = console.log, prefisso = '[pacchetti]', opzioni } = {}) {
  try {
    if (!pacchettiDaInstallare(radice, opzioni).length) return { esito: 'allineati', mancanti: [] };
    const base = baseDeiPacchetti(radice);
    if (!base) {
      log(`${prefisso} node_modules manca: lancia npm install.`);
      return { esito: 'non riuscita', mancanti: pacchettiDaInstallare(radice, opzioni) };
    }
    const proprietario = dirname(realpathSync(join(base, 'node_modules')));
    const r = allinea(proprietario, { log, prefisso, opzioni }) || {};
    const restano = pacchettiDaInstallare(radice, opzioni);
    if (!restano.length) return { esito: r.esito === 'allineati' ? 'allineati' : 'installati', mancanti: [] };
    if (resolve(proprietario) !== resolve(radice) && r.esito !== 'rimandati') {
      log(`${prefisso} Mancano ancora ${descrivi(restano)}: li chiede il lock di questo ramo, non quello di ${proprietario}, da cui arrivano i pacchetti. Installali lì a mano, o dagli un node_modules suo.`);
    }
    return { esito: r.esito === 'rimandati' ? 'rimandati' : 'non riuscita', mancanti: restano };
  } catch (e) {
    log(`${prefisso} Controllo dei pacchetti saltato: ${e && e.message ? e.message : e}.`);
    return { esito: 'non riuscita', mancanti: [] };
  }
}
