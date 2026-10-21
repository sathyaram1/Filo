// Regole esatte, senza jolly, per i comandi git dei riallineamenti delle routine: in modalità auto un comando senza
// regola lo giudica il classificatore, che li ferma. Mai il push forzato: lo fa il gancio di salvataggio.
// Le installa il preflight nelle impostazioni utente, dove il ramo vecchio non arriva: tests/unit/permessiRoutine.test.mjs.

export const REGOLE_GIT = Object.freeze([
  'Bash(git fetch origin main)',
  'Bash(git rebase origin/main)',
  'Bash(git rebase --continue)',
  'Bash(git rebase --abort)',
  'Bash(git pull --rebase origin main)',
]);

// Un percorso con virgolette, `$` o apici renderebbe la regola esatta una porta per un comando diverso.
const PERCORSO_SICURO = /^[A-Za-z0-9._/ :~-]+$/;

/** Le regole di un giro: quelle fisse più la fusione nel clone del server, col percorso che il ruolo stampa. PURA. */
export function regoleGit({ clone = '' } = {}) {
  const c = String(clone || '').split('\\').join('/');
  return PERCORSO_SICURO.test(c) ? [...REGOLE_GIT, `Bash(git -C "${c}" merge origin/main)`] : [...REGOLE_GIT];
}

/** Le regole aggiunte in coda a `permissions.allow`, senza doppioni e senza toccare il resto. PURA. */
export function unisciPermessi(impostazioni, regole = REGOLE_GIT) {
  const s = impostazioni && typeof impostazioni === 'object' ? impostazioni : {};
  const permessi = s.permissions && typeof s.permissions === 'object' ? s.permissions : {};
  const allow = Array.isArray(permessi.allow) ? permessi.allow : [];
  return { ...s, permissions: { ...permessi, allow: [...new Set([...allow, ...regole])] } };
}

/** Il comando che una regola `Bash(…)` ammette, o null per una regola d'altro tipo o col jolly. PURA. */
export function comandoDellaRegola(regola) {
  const m = /^Bash\((.+)\)$/.exec(String(regola || ''));
  return m && !m[1].includes('*') ? m[1] : null;
}
