// Il testo di un file del repo, coi fini riga normalizzati.
//
// PERCHE' ESISTE
//   Le sentinelle leggono file del repo e li analizzano riga per riga: le
//   regole Firestore e Storage, l'indice dei pattern, i sorgenti. Come arrivano
//   quelle righe lo decide però la MACCHINA, non il repo: Git for Windows
//   converte in CRLF al checkout, e allora una ricerca che contiene un «a capo»
//   (`indexOf('allow update: if\n        isAdmin()')`) non trova più niente, un
//   `$` di una regex non arriva mai in fondo alla riga, un confronto esatto
//   fallisce per un carattere invisibile. Il test diventa rosso su una macchina
//   sola — e quella macchina è il cancello della pubblicazione, dove il rosso
//   vale «nessuna versione per nessuno».
//
//   E' successo due volte: #565 (l'indice dei pattern «senza nessuna voce») e
//   #569 (il ramo di update delle regole «mancante»). In tutti e due i casi il
//   file era giusto e il codice era giusto: a cambiare era il checkout.
//
//   `.gitattributes` toglie il problema alla radice (LF ovunque), ma solo per
//   le copie scaricate DOPO: una copia già sul disco tiene i suoi CRLF finché
//   il file non viene riscritto. Questo lettore toglie il problema anche lì, ed
//   è la porta da usare sempre — come `cartellaTemporanea()` per le cartelle
//   temporanee. Una sentinella (tests/unit/finiDiRiga.test.mjs) diventa rossa
//   se un test torna a leggere un file di regole o di indice per conto suo.

import { readFileSync } from 'node:fs';

/**
 * Normalizza i fini riga di un testo: CRLF (Windows) e CR solo (vecchi Mac)
 * diventano LF. PURA — serve anche a provare un testo "come arriverebbe da un
 * checkout di Windows" senza toccare il disco.
 */
export function normalizzaFiniRiga(testo) {
  return String(testo).replace(/\r\n?/g, '\n');
}

/**
 * Legge un file di testo del repo con i fini riga normalizzati a LF.
 * Da usare al posto di `readFileSync(percorso, 'utf8')` ogni volta che quello
 * che si legge viene poi ANALIZZATO (righe, ricerche, regex): così il test
 * misura il contenuto del file, non il sistema operativo di chi lo esegue.
 */
export function leggiTestoRepo(percorso) {
  return normalizzaFiniRiga(readFileSync(percorso, 'utf8'));
}
