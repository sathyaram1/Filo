// Regole esatte, senza jolly, per i comandi git del riallineamento delle routine: in modalità auto un comando senza regola
// lo giudica il classificatore, che li ferma (#1454). Mai il push forzato: lo fa il gancio di salvataggio. Le scrive il
// preflight nelle impostazioni utente del contenitore, dove un ramo vecchio non arriva. Sentinella: tests/unit/riallineamentoComandi.test.mjs.

export const REGOLE_GIT = Object.freeze([
  'Bash(git fetch origin main)',
  'Bash(git rebase origin/main)',
  'Bash(git rebase --continue)',
  'Bash(git rebase --abort)',
  'Bash(git pull --rebase origin main)',
]);

// Virgolette, apici, `$` o barre rovesciate nel percorso farebbero di una regola esatta una porta per un comando diverso.
const PERCORSO_SICURO = /^[A-Za-z0-9._/ :~-]+$/;

/**
 * La fusione di main nel clone del server, come la stampa il ruolo (_lavoro-server.md): col percorso fra virgolette e, se
 * non ha spazi, anche senza (il confronto è sul testo scritto, virgolette comprese). [] se il percorso non è sicuro. PURA.
 */
export function regoleMergeServer(clone) {
  const c = String(clone || '').split('\\').join('/');
  if (!PERCORSO_SICURO.test(c)) return [];
  const forme = [`Bash(git -C "${c}" merge origin/main)`];
  if (!c.includes(' ')) forme.push(`Bash(git -C ${c} merge origin/main)`);
  return forme;
}

/** Le regole di un giro: quelle fisse più la fusione nel clone del server. PURA. */
export function regoleGit({ clone = '' } = {}) {
  return [...REGOLE_GIT, ...regoleMergeServer(clone)];
}

/** Il comando che una regola `Bash(…)` ammette, o null per una regola d'altro tipo o col jolly. PURA. */
export function comandoDellaRegola(regola) {
  const m = /^Bash\((.+)\)$/.exec(String(regola || ''));
  return m && !m[1].includes('*') ? m[1] : null;
}
