// Percorsi CANONICI per i test.
//
// Perché esiste questo file. Su Windows, quando il nome dell'utente contiene
// uno spazio (o un carattere non ASCII), il sistema mette in `%TEMP%` la forma
// ABBREVIATA 8.3 del percorso: `C:\Users\AGENTI~1\AppData\Local\Temp` invece di
// `C:\Users\agenti AI\AppData\Local\Temp`. `os.tmpdir()` restituisce quella, e
// quindi ogni cartella temporanea che un test si crea nasce abbreviata.
//
// L'app, invece, riporta sempre la forma LUNGA: Chromium canonicalizza il
// percorso di salvataggio di uno scaricamento, e la shell riporta come cartella
// corrente quella vera, non quella con cui ci sei entrato. Due nomi dello stesso
// posto — e ogni `expect(quelloCheDiceFilo).toBe(quelloCheHoCostruitoIo)`
// diventa rosso su quella macchina e verde su tutte le altre.
//
// La cura è UNA e sta qui: la cartella temporanea di un test nasce già nella
// forma canonica, quindi i due lati del confronto parlano la stessa lingua.
// `fs.realpathSync` NON basta — la sua versione JS segue solo i collegamenti
// simbolici; è `realpathSync.native` che passa da `GetFinalPathNameByHandle` e
// riporta il nome lungo. Fuori da Windows fa il suo lavoro di sempre (risolve
// `/tmp` → `/private/tmp` su macOS), quindi si usa ovunque.

import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path, { join } from 'node:path';

// Forma canonica di un percorso ESISTENTE. Se il percorso non c'è (o il sistema
// non sa risolverlo) torna quello che gli è stato dato: un test non deve morire
// qui, deve fallire — se fallisce — sulla cosa che stava verificando.
export function percorsoCanonico(p) {
  try { return realpathSync.native(String(p)); } catch (_) {}
  try { return realpathSync(String(p)); } catch (_) {}
  return p;
}

// La cartella temporanea di sistema, canonica.
export function tempCanonico() {
  return percorsoCanonico(tmpdir());
}

// Lo SPAZIO che ogni cartella temporanea dei test si porta nel nome.
//
// L'utente di chi sviluppa Filo si chiama «agenti AI», quindi da lui ogni
// percorso ha uno spazio dentro e altrove no: cinque delle undici prove rimaste
// rosse per settimane (feedback #563) erano codice che si spezzava proprio lì, e
// le vedeva una macchina sola. Un modo di RIMETTERE lo spazio a comando non
// basterebbe: chi non sa che esiste non lo accende. Quindi lo spazio c'è sempre,
// per tutti, e quella differenza fra le due macchine sparisce invece di restare
// in attesa di essere riprodotta. La suite intera (1486 casi) è stata girata su
// percorsi spaziati prima di renderlo la regola (una volta: dal 2026-09-15 la
// suite gira solo in GitHub Actions a ogni fusione su main, nessuno la lancia).
export const SPAZIO = 'con spazio-';

// Una cartella temporanea nuova, già canonica e con uno spazio nel nome. Da
// usare al posto di `mkdtempSync(join(tmpdir(), prefisso))` in qualunque test:
// una sentinella negli unit test diventa rossa se qualcuno torna alla forma
// vecchia. Il prefisso resta in testa, così la cartella si riconosce a occhio.
export function cartellaTemporanea(prefisso) {
  return percorsoCanonico(mkdtempSync(join(tmpdir(), `${prefisso}${SPAZIO}`)));
}

// Una cartella nuova DENTRO la cartella personale: è lì che il perimetro di
// lettura (#587) lascia leggere senza chiedere. La temporanea di sistema sta
// fuori (`/tmp`) o in AppData, dove ogni lettura chiede un OK.
export function cartellaInCasa(prefisso) {
  return percorsoCanonico(mkdtempSync(join(homedir(), `${prefisso}${SPAZIO}`)));
}

// Su Windows un symlink vuole l'amministratore o la modalità sviluppatore (EPERM, #742):
// una junction no, e Node la risolve allo stesso modo. Altrove resta un symlink.
export function collegaCartella(verso, collegamento, { sistema = process.platform, collega = symlinkSync } = {}) {
  collega(verso, collegamento, sistema === 'win32' ? 'junction' : 'dir');
}

// Un file non ha junction: dove Windows nega il symlink torna il motivo, da passare a `t.skip`
// (altrimenti null). Altrove l'errore resta un errore: lì il caso deve girare.
export const COLLEGAMENTO_NEGATO = 'Windows nega il collegamento simbolico senza amministratore né modalità sviluppatore (EPERM)';
export function collegaFile(verso, collegamento, { sistema = process.platform, collega = symlinkSync } = {}) {
  try {
    collega(verso, collegamento, 'file');
    return null;
  } catch (e) {
    if (sistema === 'win32' && e && e.code === 'EPERM') return COLLEGAMENTO_NEGATO;
    throw e;
  }
}

// Un nome che Windows non scrive su disco («:» di un sysfs Linux, #961): lì nasce codificato con `nomeSuDisco`,
// e `nomiVeri` lo rimette com'è davanti a chi legge con quel `fs`. Altrove il nome nasce vero e `nomiVeri` non fa niente.
const VIETATI_SU_WINDOWS = /[<>:"|?*]/g;
const CODIFICATI = /%(3C|3E|3A|22|7C|3F|2A)/g;
export function nomeSuDisco(nome, sistema = process.platform) {
  if (sistema !== 'win32') return nome;
  return nome.replace(VIETATI_SU_WINDOWS, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function nomiVeri(fs, radice, sistema = process.platform) {
  if (sistema !== 'win32') return () => {};
  const dentro = (p) => typeof p === 'string' && !fuoriDa(radice, p);
  const suDisco = (p) => (dentro(p) ? join(radice, ...path.relative(radice, p).split(/[\\/]/).map((x) => nomeSuDisco(x, sistema))) : p);
  const originali = {};
  for (const n of ['readFileSync', 'accessSync', 'existsSync', 'statSync', 'lstatSync', 'readdirSync']) {
    const f = fs[n];
    originali[n] = f;
    fs[n] = n === 'readdirSync'
      ? function (p, ...r) {
        const voci = f.call(this, suDisco(p), ...r);
        return dentro(p) ? voci.map((v) => (typeof v === 'string' ? v.replace(CODIFICATI, (_, h) => String.fromCharCode(parseInt(h, 16))) : v)) : voci;
      }
      : function (p, ...r) { return f.call(this, suDisco(p), ...r); };
  }
  return () => Object.assign(fs, originali);
}

// Il percorso sta fuori dalla cartella. Fra due dischi (sul cancello Windows il repo è su D:, la temporanea su C:)
// `relative` risponde con un percorso assoluto, senza nessun `..` davanti: chiedere solo il `..` lì dice «dentro».
// `sistema` è `path.win32` nelle prove che girano altrove.
export function fuoriDa(cartella, p, sistema = path) {
  const r = sistema.relative(cartella, p);
  return r === '..' || r.startsWith(`..${sistema.sep}`) || sistema.isAbsolute(r);
}
