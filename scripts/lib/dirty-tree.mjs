// dirty-tree.mjs — i file che il salvataggio automatico committerebbe DOPO.
//
// PERCHÉ ESISTE
//   La critica di una verifica vale per un commit preciso. Se nella directory
//   ci sono file non registrati (di solito le spec temporanee della verifica,
//   scritte e poi tolte), il salvataggio automatico li committa DOPO la
//   registrazione: la punta del ramo si sposta, e chi chiude — il cancello di
//   fusione in cloud, `npm run finish` in locale — respinge il lavoro come
//   «verificato su un altro commit» (#256: le spec tolte tredici secondi dopo
//   il pass, e il lavoro fermo due giorni).
//
//   La regola vale su TUTTE E DUE le strade, quella delle routine
//   (dispatch --record-verifier) e quella locale (verify-local critica): una
//   fonte sola, così una porta chiusa da una parte non resta aperta dall'altra.

import { execFileSync } from 'node:child_process';

/**
 * Le righe di `git status --porcelain` (modificati, aggiunti, tolti, non
 * tracciati), ridotte al percorso. PURA.
 */
export function dirtyTreeLines(porcelain) {
  return String(porcelain || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 3)
    .map((l) => l.slice(3).replace(/^"(.*)"$/, '$1'));
}

/**
 * Il rifiuto per una directory non pulita, con l'elenco e il rimedio. PURA.
 *
 * Il rimedio dice anche COME si arriva al commit: il salvataggio automatico
 * parte solo a un Edit o a un Write, quindi dopo un `rm` dalla shell (il modo
 * normale di togliere una spec) non arriva da solo, e aspettarlo è aspettare
 * niente. Committare da sé la pulizia va bene.
 */
export function dirtyTreeText(lines) {
  const elenco = (Array.isArray(lines) ? lines : []).slice(0, 30).map((l) => `  ${l}`).join('\n');
  const altri = Array.isArray(lines) && lines.length > 30 ? `\n  … e altri ${lines.length - 30}` : '';
  return 'critica non registrata: ci sono file non registrati nella directory, e il salvataggio automatico li committerebbe DOPO il verdetto, spostando la punta del ramo (il pass vale per un commit preciso, e chi chiude — il cancello di fusione, o «npm run finish» in locale — respingerebbe quello nuovo). '
    + 'Togli le tue spec temporanee (o registra ciò che deve restare) e porta la directory a un commit: il salvataggio automatico parte solo al prossimo Edit o Write, dopo un rm dalla shell non arriva da solo — committare tu la pulizia va bene (git add -A && git commit -m "verifica: pulizia"). Poi riprova con la stessa critica.\n'
    + `${elenco}${altri}`;
}

/**
 * Lo stato della directory come lo vede git, coi nomi VERI: senza
 * `core.quotepath=false` un nome con lettere accentate arriva in sequenze
 * ottali («\303\250»), e l'elenco del rifiuto non dice quale file è.
 */
export function gitStatusPorcelain(root) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain', '--untracked-files=all'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (_) {
    return '';
  }
}
