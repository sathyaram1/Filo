// Per l'hook di salvataggio. `<cartella>`: stampa, separati da NUL, i file in scena che sono copie di dati del server e li
// toglie dalla vista di git (l'indice lo tocca l'hook). `--spedizione <cartella> <nome> <email>`: toglie le copie dai commit
// da spedire; stampa cosa è successo, ed esce 3 se il ramo non può partire. `--pre-push <cartella>`: il pre-push di git,
// esce 1 se il push porterebbe una copia. `--installa <cartella>`: mette quel pre-push. Un errore qui non ferma niente. #1108.

import { readFileSync } from 'node:fs';
import { copieInScena, spedibileSenzaCopie, escludiInLocale, copieNelPush, avvisoSpedizione, installaControlloSpedizione } from './lib/copie-di-dati.mjs';

const modo = ['--spedizione', '--pre-push', '--installa'].includes(process.argv[2]) ? process.argv[2] : '';
const root = process.argv[modo ? 3 : 2] || process.cwd();
try {
  if (modo === '--spedizione') {
    const esito = spedibileSenzaCopie(root, { nome: process.argv[4], email: process.argv[5] });
    process.stdout.write(esito.avviso);
    if (esito.stato === 'fermo') process.exitCode = 3;
  } else if (modo === '--pre-push') {
    const copie = copieNelPush(root, readFileSync(0, 'utf8'));
    if (copie.length) {
      process.stderr.write(`${avvisoSpedizione(copie)}\n`);
      process.exitCode = 1;
    }
  } else if (modo === '--installa') {
    installaControlloSpedizione(root);
  } else {
    const copie = copieInScena(root);
    if (copie.length) {
      try { escludiInLocale(root, copie.map((c) => c.file)); } catch (_) { /* l'avviso parte lo stesso */ }
      process.stdout.write(copie.map((c) => c.file).join('\0') + '\0');
    }
  }
} catch (_) { /* senza elenco l'hook salva come prima: la sentinella resta la seconda rete */ }
