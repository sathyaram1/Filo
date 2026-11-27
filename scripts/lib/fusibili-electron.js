// Il fusibile di Electron che dà alle pagine file:// privilegi che un browser non dà (#1905.1): spento nel pacchetto
// (after-pack.js), nel motore delle prove (prima-della-corsa.mjs) e in quello di `npm start` (prestart.mjs).
// Regole: patterns/un-file-del-computer-in-una-scheda-vive-in-una-sessione-sua.md. Prove: tests/unit/fusibiliElectron.test.mjs.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SENTINELLA = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
// Posto di GrantFileProtocolExtraPrivileges nel filo dei fusibili, versione 1 (@electron/fuses, FuseV1Options).
const PRIVILEGI_FILE = 7;
const ACCESO = 0x31;
const SPENTO = 0x30;
const BLOCCO = 4 * 1024 * 1024;

// L'app del Mac che contiene l'eseguibile (o l'app stessa), null fuori dal Mac: il file da spegnere e quello da
// rifirmare escono da qui, perché un conto diverso firmerebbe il posto sbagliato.
function appDelMac(eseguibile) {
  const p = String(eseguibile || '');
  if (p.endsWith('.app')) return p;
  return /\.app[\\/]Contents[\\/]MacOS[\\/]/.test(p) ? p.split(/[\\/]Contents[\\/]MacOS[\\/]/)[0] : null;
}

// Il file che porta il filo: su Mac il framework dentro l'app, altrove l'eseguibile.
function fileDelFilo(eseguibile) {
  const app = appDelMac(eseguibile);
  return app ? path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework') : String(eseguibile || '');
}

// Le posizioni del byte del fusibile, una per filo (due in un binario universale del Mac).
function posizioni(fd, file) {
  const { size } = fs.fstatSync(fd);
  const buf = Buffer.alloc(BLOCCO + SENTINELLA.length + 2 + PRIVILEGI_FILE + 1);
  const trovate = [];
  for (let da = 0; da < size; da += BLOCCO) {
    const letti = fs.readSync(fd, buf, 0, buf.length, da);
    let i = buf.subarray(0, letti).indexOf(SENTINELLA);
    while (i !== -1 && i < BLOCCO) {
      const versione = buf[i + SENTINELLA.length];
      const lunghezza = buf[i + SENTINELLA.length + 1];
      if (versione !== 1) throw new Error(`filo dei fusibili alla versione ${versione}, atteso 1`);
      if (lunghezza <= PRIVILEGI_FILE) throw new Error('il filo dei fusibili non arriva a GrantFileProtocolExtraPrivileges');
      trovate.push(da + i + SENTINELLA.length + 2 + PRIVILEGI_FILE);
      i = buf.subarray(0, letti).indexOf(SENTINELLA, i + 1);
    }
  }
  if (!trovate.length) throw new Error(`nessun filo dei fusibili in ${file}`);
  return trovate;
}

function leggiByte(fd, pos) {
  const b = Buffer.alloc(1);
  fs.readSync(fd, b, 0, 1, pos);
  return b[0];
}

// 'acceso' | 'spento'. Lancia se il file non c'è o non ha il filo.
function privilegiFile(eseguibile) {
  const file = fileDelFilo(eseguibile);
  const fd = fs.openSync(file, 'r');
  try {
    const stati = posizioni(fd, file).map((p) => leggiByte(fd, p));
    if (stati.some((s) => s !== ACCESO && s !== SPENTO)) throw new Error('GrantFileProtocolExtraPrivileges segnato come tolto');
    return stati.every((s) => s === SPENTO) ? 'spento' : 'acceso';
  } finally { fs.closeSync(fd); }
}

// Spegne il fusibile in ogni filo del file. `firma`: su Mac l'app modificata va rifirmata in locale, o non parte;
// nel pacchetto la firma la mette after-pack-mac.js, sul risultato fuso. Vero se ha cambiato qualcosa.
function spegniPrivilegiFile(eseguibile, { firma = false, piattaforma = process.platform } = {}) {
  const file = fileDelFilo(eseguibile);
  if (privilegiFile(eseguibile) === 'spento') return false;
  const fd = fs.openSync(file, 'r+');
  try {
    for (const p of posizioni(fd, file)) fs.writeSync(fd, Buffer.from([SPENTO]), 0, 1, p);
  } finally { fs.closeSync(fd); }
  if (privilegiFile(eseguibile) !== 'spento') throw new Error(`il fusibile in ${file} non si è spento`);
  const app = appDelMac(eseguibile);
  if (firma && piattaforma === 'darwin' && app) {
    const r = spawnSync('codesign', ['--sign', '-', '--force', '--preserve-metadata=entitlements,requirements,flags,runtime', '--deep', app], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`firma locale dopo il fusibile non riuscita: ${(r.stderr || r.error || '').toString().trim()}`);
  }
  return true;
}

// L'eseguibile dentro la cartella di un pacchetto appena fatto: Mac e Linux col conto dei loro passi, che lo toccano dopo.
function eseguibileDelPacchetto(context) {
  switch (context.electronPlatformName) {
    case 'darwin':
    case 'mas':
      return require('../after-pack-mac').appDelPacchetto(context);
    case 'win32':
      return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
    default: {
      // Dopo il lanciatore (una seconda passata sulla stessa cartella) il programma vero è quello col suffisso.
      const { programma, vero } = require('../after-pack-linux').programmiDelPacchetto(context);
      return fs.existsSync(vero) ? vero : programma;
    }
  }
}

// Per after-pack: su ogni sistema, prima della firma del Mac e del lanciatore di Linux, che sposta l'eseguibile. Del
// Mac universale si tocca solo il risultato fuso, che porta i fili delle due copie intermedie. Un pacchetto col
// fusibile acceso non esce: lancia.
async function afterPack(context) {
  const mac = context.electronPlatformName === 'darwin' || context.electronPlatformName === 'mas';
  if (mac && require('../after-pack-mac').COPIA_INTERMEDIA.test(context.appOutDir)) return;
  const eseguibile = eseguibileDelPacchetto(context);
  const cambiato = spegniPrivilegiFile(eseguibile);
  console.log(`[after-pack-fusibili] privilegi delle pagine file:// ${cambiato ? 'spenti' : 'già spenti'} in ${eseguibile}`);
}

// Dove sta la copia spenta: la cache dell'utente, fuori da ogni checkout e dalla temporanea della corsa, che se ne va
// con lei. Un node_modules creato apposta per la copia fa credere ai controlli dei pacchetti che manchino tutti.
function cartellaDelleCopie({ piattaforma = process.platform, env = process.env, casa = os.homedir() } = {}) {
  if (piattaforma === 'win32') return path.join(env.LOCALAPPDATA || casa, 'Filo', 'motori');
  if (piattaforma === 'darwin') return path.join(casa, 'Library', 'Caches', 'Filo', 'motori');
  return path.join(env.XDG_CACHE_HOME || path.join(casa, '.cache'), 'filo', 'motori');
}

// Il motore di sviluppo (node_modules/electron) senza privilegi: spento sul posto se il pacchetto è di questo
// checkout; se non lo è (un clone che usa i moduli di un'altra cartella) o non si può scrivere, una copia spenta in
// `cache`, che chi lancia usa con ELECTRON_OVERRIDE_DIST_PATH. { dist, copia } o { errore }.
function motoreSenzaPrivilegi({ radice, cache = null, piattaforma = process.platform } = {}) {
  let cartella;
  try { cartella = path.dirname(require.resolve('electron/package.json', { paths: [radice] })); } catch (_) { return { errore: 'electron non installato' }; }
  const dist = path.join(cartella, 'dist');
  let relativo = '';
  try { relativo = fs.readFileSync(path.join(cartella, 'path.txt'), 'utf8').trim(); } catch (_) { return { errore: 'electron senza path.txt' }; }
  const eseguibile = path.join(dist, relativo);
  if (!fs.existsSync(eseguibile)) return { errore: `binario di electron assente: ${eseguibile}` };
  try {
    if (privilegiFile(eseguibile) === 'spento') return { dist, copia: false };
  } catch (e) { return { errore: e.message }; }
  const suo = !path.relative(fs.realpathSync(radice), fs.realpathSync(cartella)).startsWith('..');
  if (suo) {
    try { spegniPrivilegiFile(eseguibile, { firma: true, piattaforma }); return { dist, copia: false }; } catch (_) {}
  }
  if (!cache) return { errore: 'il motore non è di questo checkout e manca una cartella per la copia' };
  let versione = 'x';
  try { versione = fs.readFileSync(path.join(dist, 'version'), 'utf8').trim(); } catch (_) {}
  const copia = path.join(cache, `electron-${versione}-${process.arch}-senza-privilegi-file`);
  const eseguibileCopia = path.join(copia, relativo);
  try { if (privilegiFile(eseguibileCopia) === 'spento') return { dist: copia, copia: true }; } catch (_) {}
  const temp = `${copia}.${process.pid}.tmp`;
  try {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.mkdirSync(cache, { recursive: true });
    fs.cpSync(dist, temp, { recursive: true, verbatimSymlinks: true });
    spegniPrivilegiFile(path.join(temp, relativo), { firma: true, piattaforma });
    fs.rmSync(copia, { recursive: true, force: true });
    fs.renameSync(temp, copia);
  } catch (e) {
    fs.rmSync(temp, { recursive: true, force: true });
    // Un'altra corsa l'ha messa prima di noi.
    try { if (privilegiFile(eseguibileCopia) === 'spento') return { dist: copia, copia: true }; } catch (_) {}
    return { errore: `copia del motore senza privilegi non riuscita: ${e.message}` };
  }
  return { dist: copia, copia: true };
}

module.exports = {
  SENTINELLA, PRIVILEGI_FILE, appDelMac, fileDelFilo, privilegiFile, spegniPrivilegiFile, eseguibileDelPacchetto, afterPack,
  cartellaDelleCopie, motoreSenzaPrivilegi,
};
