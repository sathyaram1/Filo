// Per l'hook di salvataggio. `<cartella>`: stampa, separati da NUL, i file in scena che sono copie di dati del server e li
// toglie dalla vista di git (l'indice lo tocca l'hook). `--spedizione <cartella> <nome> <email>`: toglie le copie dai commit
// da spedire; stampa cosa è successo, ed esce 3 se il ramo non può partire. Un errore qui non ferma il salvataggio. #1108.

import { copieInScena, spedibileSenzaCopie, escludiInLocale } from './lib/copie-di-dati.mjs';

const spedizione = process.argv[2] === '--spedizione';
const root = process.argv[spedizione ? 3 : 2] || process.cwd();
try {
  if (spedizione) {
    const esito = spedibileSenzaCopie(root, { nome: process.argv[4], email: process.argv[5] });
    process.stdout.write(esito.avviso);
    if (esito.stato === 'fermo') process.exitCode = 3;
  } else {
    const copie = copieInScena(root);
    if (copie.length) {
      try { escludiInLocale(root, copie.map((c) => c.file)); } catch (_) { /* l'avviso parte lo stesso */ }
      process.stdout.write(copie.map((c) => c.file).join('\0') + '\0');
    }
  }
} catch (_) { /* senza elenco l'hook salva come prima: la sentinella resta la seconda rete */ }
