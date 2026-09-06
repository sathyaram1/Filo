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

// Una cartella temporanea nuova, già canonica. Da usare al posto di
// `mkdtempSync(join(tmpdir(), prefisso))` in qualunque test che poi confronti
// quel percorso con uno che arriva dall'app.
export function cartellaTemporanea(prefisso) {
  return percorsoCanonico(mkdtempSync(join(tmpdir(), prefisso)));
}
