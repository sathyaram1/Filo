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

import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
// percorsi spaziati prima di renderlo la regola.
export const SPAZIO = 'con spazio-';

// Una cartella temporanea nuova, già canonica e con uno spazio nel nome. Da
// usare al posto di `mkdtempSync(join(tmpdir(), prefisso))` in qualunque test:
// una sentinella negli unit test diventa rossa se qualcuno torna alla forma
// vecchia. Il prefisso resta in testa, così la cartella si riconosce a occhio.
export function cartellaTemporanea(prefisso) {
  return percorsoCanonico(mkdtempSync(join(tmpdir(), `${prefisso}${SPAZIO}`)));
}
