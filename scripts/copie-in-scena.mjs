// Per l'hook di salvataggio. `<cartella>`: stampa, separati da NUL, i file in scena che sono copie di dati del server e li
// toglie dalla vista di git in quella copia (l'indice lo tocca l'hook). `--spedizione <cartella>`: stampa perché il ramo
// non può partire, o niente. Esce sempre 0: un errore qui non deve fermare il salvataggio. Regole: #1108.

import { copieInScena, copieDaSpedire, avvisoSpedizione, escludiInLocale } from './lib/copie-di-dati.mjs';

const spedizione = process.argv[2] === '--spedizione';
const root = process.argv[spedizione ? 3 : 2] || process.cwd();
try {
  if (spedizione) {
    const copie = copieDaSpedire(root);
    if (copie.length) process.stdout.write(avvisoSpedizione(copie));
  } else {
    const copie = copieInScena(root);
    if (copie.length) {
      try { escludiInLocale(root, copie.map((c) => c.file)); } catch (_) { /* l'avviso parte lo stesso */ }
      process.stdout.write(copie.map((c) => c.file).join('\0') + '\0');
    }
  }
} catch (_) { /* senza elenco l'hook salva come prima: la sentinella resta la seconda rete */ }
