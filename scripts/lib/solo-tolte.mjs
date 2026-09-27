// Cosa è cambiato nelle prove dei giri fra due commit, e se lì si è solo TOLTO (#661).
// Condiviso da verify-local (verdetto che non decade) e lib/prove-tolte (pulizia): senza I/O oltre a git.
// Regola: patterns/le-prove-di-un-giro-stanno-nel-ramo-e-la-cartella-si-svuota.md.

import { execFileSync } from 'node:child_process';

function tryGit(args, root) {
  try { return { ok: true, out: execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message }; }
}

// ─── Il verdetto non decade per le prove del giro TOLTE (#661) ──────────────
//
// Quando il giro mette da parte un rilievo e dice «si può pubblicare», la prova
// del giro che lo riproduce si CANCELLA: il rilievo vive nel feedback appena
// nato. Quel commit sposta la punta DOPO il verdetto, e senza questa eccezione
// costava un giro intero di un'altra istanza (10/09 e 18/09, #629).
//
// LA REGOLA è la stessa del cancello di fusione del server: dopo il verdetto,
// dentro `tests/verifica/`, si può solo TOGLIERE — un file intero o delle righe
// (un caso) da un file. Nessuna riga aggiunta o cambiata, nemmeno un marcatore
// di rosso atteso o un commento: quello va nel commit di una correzione.

/** Dove vivono le prove dei giri di verifica: l'unica cartella tollerata. */
export const PROVE_GIRO = 'tests/verifica/';

/** Il percorso sta fra le prove dei giri? PURA. */
export function dentroProveGiro(percorso) {
  const p = String(percorso ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  return p.startsWith(PROVE_GIRO) && !p.split('/').includes('..');
}

/**
 * Una voce del diff è un file TOLTO dalle prove del giro? PURA.
 *
 * `stato` è la lettera di `git diff --name-status` e vale più del contenuto:
 * senza di lei un file illeggibile (git muto su `show`) somiglierebbe a un file
 * cancellato, e si tollererebbe una modifica vera. Dove la lettera non c'è —
 * una voce costruita a mano — resta il ripiego sul contenuto.
 */
function cancellata(f) {
  if (f.stato) return String(f.stato).toUpperCase().startsWith('D');
  return String(f.prima ?? '') !== '' && String(f.dopo ?? '') === '';
}

/**
 * `dopo` si ottiene da `prima` solo togliendo righe? PURA. Vuoto da una parte o
 * dall'altra è un no: un file svuotato si cancella, uno illeggibile non passa.
 */
export function soloRigheTolte(prima, dopo) {
  const a = String(prima ?? '');
  const b = String(dopo ?? '');
  if (!a || !b) return false;
  const righeA = a.replace(/\r\n?/g, '\n').split('\n');
  const righeB = b.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  for (const riga of righeB) {
    while (i < righeA.length && righeA[i] !== riga) i += 1;
    if (i >= righeA.length) return false;
    i += 1;
  }
  return true;
}

/**
 * Fra il commit verificato e quello di adesso dalle prove del giro si è solo
 * tolto (file interi o righe)? PURA.
 *
 * `files`: `[{ path, prima, dopo, stato }]` — il contenuto ai due commit,
 * stringa vuota dove il file non c'era, e la lettera di stato di git; `null`
 * quando non si è riuscito a leggere il diff, che NON è un via libera. Ritorna
 * `{ ok, motivo, files }`: `motivo` è già la frase da mostrare a chi pubblica.
 */
export function soloProveTolte(files) {
  if (!Array.isArray(files)) return { ok: false, motivo: 'non sono riuscito a leggere cosa è cambiato dopo la verifica', files: [] };
  const elenco = files.filter((f) => f && f.path);
  const fuori = elenco.filter((f) => !dentroProveGiro(f.path)).map((f) => f.path);
  if (fuori.length) {
    const primi = fuori.slice(0, 5).join(', ');
    return { ok: false, files: [], motivo: `fuori dalle prove del giro: ${primi}${fuori.length > 5 ? ` e altri ${fuori.length - 5}` : ''}` };
  }
  const veri = elenco
    .filter((f) => !cancellata(f) && (String(f.stato || '').toUpperCase().startsWith('A') || !soloRigheTolte(f.prima, f.dopo)))
    .map((f) => f.path);
  if (veri.length) {
    const primi = veri.slice(0, 5).join(', ');
    return { ok: false, files: [], motivo: `nelle prove del giro c'è dell'altro, oltre a prove e casi tolti (righe aggiunte o cambiate, file nuovi): ${primi}${veri.length > 5 ? ` e altri ${veri.length - 5}` : ''}` };
  }
  return { ok: true, motivo: '', files: elenco.map((f) => f.path) };
}

/**
 * Cosa è cambiato fra il commit verificato e quello di adesso, contenuto
 * compreso: `[{ path, prima, dopo }]`, o `[]` se git non risponde.
 *
 * I NOMI si guardano per primi, e sono l'uscita a buon mercato: se anche un
 * solo file sta fuori dalle prove del giro non si legge niente, qualunque sia
 * la dimensione del diff.
 */
export function diffDopoLaVerifica(base, head, root) {
  if (!base || !head || base === head) return null;
  const elenco = tryGit(['diff', '--name-status', '-z', `${base}`, `${head}`], root);
  // Git muto non è git contento: senza il diff non si tollera niente.
  if (!elenco.ok) return null;
  const voci = vociNameStatus(elenco.out);
  if (!voci.length || voci.some((v) => !dentroProveGiro(v.path))) {
    return voci.map((v) => ({ path: v.path, stato: v.stato, prima: '', dopo: '' }));
  }
  return voci.map((v) => ({
    path: v.path,
    stato: v.stato,
    prima: contenutoAl(base, v.path, root),
    dopo: contenutoAl(head, v.path, root),
  }));
}

/**
 * L'uscita di `git diff --name-status -z` in `[{ stato, path }]`. PURA.
 *
 * Con `-z` i campi sono separati da NUL e i nomi arrivano crudi, senza
 * virgolette: è l'unica forma in cui un percorso con uno spazio (la macchina di
 * chi sviluppa ne ha) si legge per intero. Uno spostamento (`R`) porta DUE
 * nomi e qui diventa due voci, il vecchio tolto e il nuovo aggiunto: un file
 * che ricompare altrove è roba da girare che nessuno ha ancora provato.
 */
export function vociNameStatus(out) {
  const campi = String(out ?? '').split('\0');
  const voci = [];
  for (let i = 0; i < campi.length; i += 1) {
    const stato = campi[i].trim();
    if (!stato) continue;
    const doppio = /^[RC]/i.test(stato);
    const primo = (campi[i + 1] || '').trim();
    const secondo = doppio ? (campi[i + 2] || '').trim() : '';
    i += doppio ? 2 : 1;
    if (doppio) {
      if (primo) voci.push({ stato: 'D', path: primo });
      if (secondo) voci.push({ stato: 'A', path: secondo });
    } else if (primo) voci.push({ stato: stato[0].toUpperCase(), path: primo });
  }
  return voci;
}

/** Il contenuto di un file a un commit, stringa vuota se lì non c'era. */
function contenutoAl(sha, path, root) {
  try {
    return execFileSync('git', ['show', `${sha}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_) { return ''; }
}
