// Per l'hook di salvataggio: stampa, separati da NUL, i file in scena nella cartella data che sono copie di dati del server.
// Non tocca l'indice (lo fa l'hook) ed esce sempre 0: un errore qui non deve fermare il salvataggio. Regole: #1108.

import { copieInScena } from './lib/copie-di-dati.mjs';

try {
  const copie = copieInScena(process.argv[2] || process.cwd());
  if (copie.length) process.stdout.write(copie.map((c) => c.file).join('\0') + '\0');
} catch (_) { /* senza elenco l'hook salva come prima: la sentinella resta la seconda rete */ }
