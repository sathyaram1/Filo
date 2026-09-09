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
export function dirtyTreeText(lines, cosa = 'critica') {
  const elenco = (Array.isArray(lines) ? lines : []).slice(0, 30).map((l) => `  ${l}`).join('\n');
  const altri = Array.isArray(lines) && lines.length > 30 ? `\n  … e altri ${lines.length - 30}` : '';
  // La consegna di chi ha corretto: il danno è un altro. La correzione non
  // sta in nessun commit, il server segna «corretto», e la verifica dopo
  // prova il ramo senza la correzione e ritrova gli stessi rilievi: un giro
  // sprecato (in locale «corretto» la respinge già; qui è la stessa regola).
  if (cosa === 'consegna') {
    return 'consegna non registrata: ci sono modifiche non salvate nella directory, e la consegna vale per un commit: la correzione starebbe fuori da ogni commit, il server la segnerebbe come fatta, e la verifica dopo proverebbe il ramo senza di essa, ritrovando gli stessi rilievi. '
      + 'Porta la directory a un commit: il salvataggio automatico parte solo al prossimo Edit o Write, dopo un rm dalla shell non arriva da solo — committare tu va bene (git add -A && git commit -m "correzione"). Poi riprova con lo stesso report.\n'
      + `${elenco}${altri}`;
  }
  // La prima consegna del lavoro (chi risolve mette il feedback in revisione):
  // stesso danno della correzione, un giro prima. Quello che sta fuori dai
  // commit la verifica non lo vede, e boccia una cosa che era fatta (verifica
  // del giro 3 su questo lavoro).
  if (cosa === 'revisione') {
    return 'consegna non registrata: ci sono modifiche non salvate nella directory, e la messa in revisione vale per un commit: quello che sta fuori dai commit la verifica non lo vede, e boccerebbe una cosa che in realtà è fatta. '
      + 'Porta la directory a un commit: il salvataggio automatico parte solo al prossimo Edit o Write, dopo un rm dalla shell non arriva da solo — committare tu va bene (git add -A && git commit -m "consegna"). Poi riprova con la stessa consegna.\n'
      + `${elenco}${altri}`;
  }
  return 'critica non registrata: ci sono file non registrati nella directory, e il salvataggio automatico li committerebbe DOPO il verdetto, spostando la punta del ramo (il pass vale per un commit preciso, e chi chiude — il cancello di fusione, o «npm run finish» in locale — respingerebbe quello nuovo). '
    + 'Porta la directory a un commit (le tue prove in tests/verifica/<numero>/ restano nel ramo; togli solo quello che non vale come test): il salvataggio automatico parte solo al prossimo Edit o Write, dopo un rm dalla shell non arriva da solo — committare tu va bene (git add -A && git commit -m "verifica: prove"). Poi riprova con la stessa critica.\n'
    + `${elenco}${altri}`;
}

/**
 * Lo stato della directory come lo vede git, coi nomi VERI: senza
 * `core.quotepath=false` un nome con lettere accentate arriva in sequenze
 * ottali («\303\250»), e l'elenco del rifiuto non dice quale file è.
 *
 * Se git non risponde, ALZA: prima ingoiava l'errore e tornava una stringa
 * vuota, cioè «directory pulita» — e la registrazione passava proprio nel caso
 * in cui non si sa se sia pulita. Un controllo che tace quando non può
 * rispondere è peggio di uno assente: chi lo legge crede di essere protetto.
 */
export function gitStatusPorcelain(root) {
  return execFileSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain', '--untracked-files=all'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * I file fuori dai commit, con l'esito della domanda: `{ ok, lines, motivo }`.
 * `ok: false` vuol dire «non l'ho potuto sapere», e va trattato come un
 * rifiuto, non come una directory pulita. È la porta unica delle tre strade
 * (critica, consegna, messa in revisione).
 */
export function statoDirectory(root) {
  try {
    return { ok: true, lines: dirtyTreeLines(gitStatusPorcelain(root)), motivo: '' };
  } catch (e) {
    const motivo = String((e && (e.stderr || e.message)) || e || '').trim().split(/\r?\n/)[0] || 'git non ha risposto';
    return { ok: false, lines: [], motivo };
  }
}

/** Il rifiuto quando lo stato della directory non si è potuto leggere. PURA. */
export function statoIllegibileText(motivo, cosa = 'critica') {
  const quale = cosa === 'consegna' ? 'consegna' : cosa === 'revisione' ? 'consegna' : 'critica';
  return `${quale} non registrata: non sono riuscito a farmi dire se ci sono file fuori dai commit (${motivo || 'git non ha risposto'}), `
    + 'e senza quella risposta non posso garantire che l\'esito valga per il commit giusto. '
    + 'Non tratto il silenzio come «directory pulita»: sistema git (sei nel deposito? c\'è un\'operazione a metà?) e riprova con lo stesso testo.';
}
