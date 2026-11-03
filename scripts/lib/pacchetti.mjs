// I pacchetti che package-lock.json chiede e node_modules non ha: chi avvia Filo dai sorgenti, o lancia le prove, li
// installa prima (#1572), mai fermandosi e mai sostituendo un Electron acceso; nel node_modules di un'altra cartella
// solo aggiungendo (#1572.1). Sentinella: tests/unit/pacchetti.test.mjs.

import {
  closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

export const PERCORSO_ELECTRON = 'node_modules/electron';
// Un'installazione da zero su una linea lenta sta sotto i cinque minuti; il tetto serve solo a non restare appesi.
export const TETTO_INSTALLAZIONE_MS = 15 * 60_000;
/** Il segno di un node_modules collegato voce per voce a quello di un'altra cartella (i clone dei worker). */
export const MARCA_COLLEGATI = '.filo-collegati';
// Dentro il node_modules che si completa: stesso disco, così ogni pacchetto arriva al suo posto intero o per niente.
const APPOGGIO = '.filo-complemento-';
const ELENCO_MAX = 6;
const NM = 'node_modules/';

const leggiJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch (_) { return null; } };
const eLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch (_) { return false; } };
const esiste = (p) => { try { lstatSync(p); return true; } catch (_) { return false; } };
export const collegatoVoceAVoce = (nm) => existsSync(join(nm, MARCA_COLLEGATI));

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
    if (!percorso.startsWith(NM) || !v || typeof v !== 'object') continue;
    if (v.link || v.optional || v.devOptional) continue;
    if (!ammesso(v.os, platform) || !ammesso(v.cpu, arch)) continue;
    const nome = v.name || percorso.slice(percorso.lastIndexOf(NM) + NM.length);
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

/**
 * Le voci che il lock di `radice` chiede e che il node_modules di `base` (di serie quello da cui Node risolve
 * `radice`) non ha, o ha in un'altra versione, con quella trovata.
 */
export function pacchettiDaInstallare(radice, { base = baseDeiPacchetti(radice), ...opzioni } = {}) {
  const voci = vociRichieste(leggiJson(join(radice, 'package-lock.json')), opzioni);
  if (!voci.length) return [];
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
  const nomi = voci.slice(0, ELENCO_MAX).map((v) => (v.versione ? `${v.nome} ${v.versione}` : v.nome)
    + (v.trovata ? ` (c'è ${v.trovata})` : ''));
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
export function npmInstall(radice, extra = []) {
  const r = spawnSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--prefer-offline', ...extra], {
    cwd: radice, stdio: 'inherit', shell: process.platform === 'win32', timeout: TETTO_INSTALLAZIONE_MS,
  });
  return { codice: r.status === null ? 1 : r.status, errore: r.error ? String(r.error.message || r.error) : '' };
}

// I peer li dà il node_modules che si completa: installarli nell'appoggio scaricherebbe per niente (anche Electron).
const npmInstallComplemento = (appoggio) => npmInstall(appoggio, ['--legacy-peer-deps']);

// Fuori da node_modules: crearlo per il blocco cambierebbe da dove un worktree risolve i pacchetti. Dal percorso vero:
// chi arriva dal collegamento di un worktree o di finish deve trovare lo stesso blocco del pre-avvio.
export function fileBlocco(radice, cartella = tmpdir()) {
  let vero = resolve(radice);
  try { vero = realpathSync(vero); } catch (_) { /* non ancora creata */ }
  const impronta = createHash('sha1').update(vero).digest('hex').slice(0, 16);
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

/**
 * Due avvii in fretta (il doppio clic) non installano insieme nello stesso node_modules: chi arriva secondo aspetta e
 * ricontrolla. `{ f, mancanti }` col turno preso, o `{ esito, mancanti }` senza.
 */
function turno(cartella, daFare, { cartellaBlocchi, ora, attendi, log, prefisso, intanto }) {
  const f = fileBlocco(cartella, cartellaBlocchi);
  if (prendiBlocco(f, ora)) return { f, mancanti: daFare() };
  log(`${prefisso} Un altro avvio sta installando i pacchetti: aspetto che finisca.`);
  for (const fine = ora() + TETTO_INSTALLAZIONE_MS; existsSync(f) && ora() < fine;) attendi(500);
  const mancanti = daFare();
  if (!mancanti.length) return { esito: 'allineati', mancanti };
  if (prendiBlocco(f, ora)) return { f, mancanti };
  log(`${prefisso} Mancano ${descrivi(mancanti)}, e l'altro avvio non ha ancora finito: ${intanto}`);
  return { esito: 'rimandati', mancanti };
}

const lascia = (f) => { if (f) { try { rmSync(f, { force: true }); } catch (_) { /* lo toglie il tetto */ } } };

/** `{ esito, mancanti }`, esito fra allineati, installati, rimandati e non riuscita. Non lancia mai. */
export function allineaPacchetti(radice, {
  installa = npmInstall, inUso = electronInUso, log = console.log, prefisso = '[pacchetti]', opzioni,
  cartellaBlocchi = tmpdir(), ora = Date.now, attendi = dormi,
} = {}) {
  let blocco = '';
  try {
    if (!pacchettiDaInstallare(radice, opzioni).length) return { esito: 'allineati', mancanti: [] };
    const t = turno(radice, () => pacchettiDaInstallare(radice, opzioni), {
      cartellaBlocchi, ora, attendi, log, prefisso, intanto: 'Filo parte lo stesso.',
    });
    if (!t.f) return { esito: t.esito, mancanti: t.mancanti };
    blocco = t.f;
    const { mancanti } = t;
    if (!mancanti.length) return { esito: 'allineati', mancanti };
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
    lascia(blocco);
  }
}

/** `node_modules/@a/b/node_modules/c` → `node_modules/@a/b`: il pacchetto di primo livello che lo contiene. PURA. */
export function primoLivello(percorso) {
  const resto = String(percorso).slice(NM.length).split('/');
  return NM + (resto[0].startsWith('@') ? resto.slice(0, 2) : resto.slice(0, 1)).join('/');
}

/** Come l'appoggio chiede una voce del lock: la versione fissata, o la sorgente se non viene dal registro. PURA. */
export function richiestaDi(voce, cartella, radice) {
  const sorgente = typeof voce.resolved === 'string' ? voce.resolved : '';
  if (sorgente.startsWith('file:')) return `file:${resolve(radice, sorgente.slice('file:'.length))}`;
  if (sorgente && !/^https?:/i.test(sorgente)) return sorgente;
  if (!voce.version) return sorgente || '*';
  return voce.name && voce.name !== cartella ? `npm:${voce.name}@${voce.version}` : voce.version;
}

/**
 * L'appoggio: un progetto che chiede solo i pacchetti assenti, col pezzo del lock dell'albero che li riguarda, così
 * npm li mette con le versioni e al posto che il lock dice. PURA.
 */
export function progettoDiAppoggio(lock, assenti, radice) {
  const pezzi = new Set(assenti.map((v) => v.percorso));
  const dependencies = {};
  for (const p of [...pezzi].sort()) dependencies[p.slice(NM.length)] = richiestaDi(lock.packages[p], p.slice(NM.length), radice);
  const packages = { '': { name: 'filo-complemento', version: '0.0.0', dependencies } };
  for (const [p, v] of Object.entries(lock.packages)) {
    if (!p.startsWith(NM) || !pezzi.has(primoLivello(p)) || !v || typeof v !== 'object') continue;
    const r = typeof v.resolved === 'string' && v.resolved.startsWith('file:') ? { resolved: richiestaDi(v, '', radice) } : {};
    packages[p] = { ...v, ...r };
  }
  return {
    pacchetto: { name: 'filo-complemento', version: '0.0.0', private: true, dependencies },
    lock: { name: 'filo-complemento', version: '0.0.0', lockfileVersion: 3, requires: true, packages },
  };
}

/** Lo sposta solo se non attraversa un collegamento: scrivere lì cambierebbe la cartella a cui porta. */
function mettiAlPosto(da, a, nm) {
  for (let d = dirname(a); d.length > nm.length; d = dirname(d)) if (eLink(d)) return false;
  mkdirSync(dirname(a), { recursive: true });
  for (let i = 0; ; i += 1) {
    try { renameSync(da, a); return true; } catch (e) {
      // Su Windows un antivirus tiene per un attimo i file appena estratti.
      if (i >= 2 || !e || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) return false;
      dormi(300);
    }
  }
}

/**
 * Le prove di un albero che risolve i pacchetti da un node_modules non suo (della cartella principale, o di un clone
 * collegato voce per voce): si aggiungono i pacchetti di primo livello che il SUO lock chiede e lì mancano, e niente
 * di ciò che c'è si toglie o cambia. Le versioni diverse si dicono. `{ esito, mancanti }`; non lancia mai.
 */
export function completaPacchetti(radice, {
  installa = npmInstallComplemento, log = console.log, prefisso = '[pacchetti]', opzioni,
  cartellaBlocchi = tmpdir(), ora = Date.now, attendi = dormi,
} = {}) {
  let blocco = '';
  let appoggio = '';
  try {
    const base = baseDeiPacchetti(radice);
    if (!base) return { esito: 'non riuscita', mancanti: pacchettiDaInstallare(radice, opzioni) };
    const nm = realpathSync(join(base, 'node_modules'));
    const proprietario = dirname(nm);
    const daFare = () => pacchettiDaInstallare(radice, opzioni);
    if (!daFare().length) return { esito: 'allineati', mancanti: [] };
    const t = turno(proprietario, daFare, { cartellaBlocchi, ora, attendi, log, prefisso, intanto: 'le prove partono lo stesso.' });
    if (!t.f) return { esito: t.esito, mancanti: t.mancanti };
    blocco = t.f;
    if (!t.mancanti.length) return { esito: 'allineati', mancanti: [] };
    // Col turno in mano un appoggio rimasto è di un'installazione morta a metà.
    for (const n of readdirSync(nm)) if (n.startsWith(APPOGGIO)) rmSync(join(nm, n), { recursive: true, force: true });
    const assenti = t.mancanti.filter((v) => primoLivello(v.percorso) === v.percorso && !esiste(join(nm, v.percorso.slice(NM.length))));
    if (assenti.length) {
      log(`${prefisso} Aggiungo a ${nm} i pacchetti che il lock di ${radice} chiede e lì mancano: ${descrivi(assenti)}. Gli altri restano com'erano.`);
      const lock = leggiJson(join(radice, 'package-lock.json'));
      const p = progettoDiAppoggio(lock, assenti, radice);
      appoggio = mkdtempSync(join(nm, APPOGGIO));
      writeFileSync(join(appoggio, 'package.json'), `${JSON.stringify(p.pacchetto, null, 2)}\n`);
      writeFileSync(join(appoggio, 'package-lock.json'), `${JSON.stringify(p.lock, null, 2)}\n`);
      // Il registro e le regole che il progetto dà a npm valgono anche qui.
      if (existsSync(join(radice, '.npmrc'))) writeFileSync(join(appoggio, '.npmrc'), readFileSync(join(radice, '.npmrc')));
      const r = installa(appoggio) || {};
      if (r.codice !== 0) {
        log(`${prefisso} Installazione non riuscita (${r.errore || `npm è uscito con ${r.codice}`}), mancano ancora: ${descrivi(assenti)}. Le prove partono lo stesso.`);
        return { esito: 'non riuscita', mancanti: daFare() };
      }
      for (const v of assenti) {
        const da = join(appoggio, v.percorso);
        const a = join(nm, v.percorso.slice(NM.length));
        if (existsSync(join(da, 'package.json')) && !esiste(a)) mettiAlPosto(da, a, nm);
      }
    }
    const restano = daFare();
    if (!restano.length) {
      log(`${prefisso} Pacchetti aggiunti.`);
      return { esito: 'installati', mancanti: [] };
    }
    const da = collegatoVoceAVoce(nm) ? String(readFileSync(join(nm, MARCA_COLLEGATI), 'utf8')).trim() || proprietario : proprietario;
    log(`${prefisso} Restano diversi da quanto chiede il lock di ${radice}: ${descrivi(restano)}. I pacchetti vengono da ${da}, e lì si aggiunge soltanto: niente si toglie o cambia. Per provare col lock intero, dai all'albero un node_modules suo (npm ci).`);
    return { esito: 'non riuscita', mancanti: restano };
  } catch (e) {
    log(`${prefisso} Controllo dei pacchetti saltato: ${e && e.message ? e.message : e}.`);
    return { esito: 'non riuscita', mancanti: [] };
  } finally {
    if (appoggio) { try { rmSync(appoggio, { recursive: true, force: true }); } catch (_) { /* lo toglie il prossimo turno */ } }
    lascia(blocco);
  }
}

/**
 * Prima delle prove, col lock dell'albero sotto prova: un node_modules tutto suo si allinea come all'avvio; quello di
 * un'altra cartella (worktree, cartella di prova di finish) o collegato voce per voce (clone dei worker) si completa
 * soltanto, mai un'installazione intera. Non lancia mai.
 */
export function allineaPerLeProve(radice, {
  allinea = allineaPacchetti, completa = completaPacchetti, log = console.log, prefisso = '[pacchetti]', opzioni,
} = {}) {
  try {
    if (!pacchettiDaInstallare(radice, opzioni).length) return { esito: 'allineati', mancanti: [] };
    const base = baseDeiPacchetti(radice);
    if (!base) {
      log(`${prefisso} node_modules manca: lancia npm install.`);
      return { esito: 'non riuscita', mancanti: pacchettiDaInstallare(radice, opzioni) };
    }
    const nm = realpathSync(join(base, 'node_modules'));
    if (dirname(nm) !== realpathSync(radice) || collegatoVoceAVoce(nm)) return completa(radice, { log, prefisso, opzioni }) || {};
    const r = allinea(radice, { log, prefisso, opzioni }) || {};
    const restano = pacchettiDaInstallare(radice, opzioni);
    if (!restano.length) return { esito: r.esito === 'allineati' ? 'allineati' : 'installati', mancanti: [] };
    return { esito: r.esito === 'rimandati' ? 'rimandati' : 'non riuscita', mancanti: restano };
  } catch (e) {
    log(`${prefisso} Controllo dei pacchetti saltato: ${e && e.message ? e.message : e}.`);
    return { esito: 'non riuscita', mancanti: [] };
  }
}
