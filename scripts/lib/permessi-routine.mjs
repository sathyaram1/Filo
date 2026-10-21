// Le regole strette che ammettono i comandi git del riallineamento, una per comando e nella forma esatta che i ruoli
// scrivono: in modalità auto il classificatore li ferma, una regola esplicita no. Mai il push forzato: lo fa il gancio.
// Dove stanno e perché in due posti: tests/unit/permessiRoutine.test.mjs.

export const REGOLE_GIT = Object.freeze([
  'Bash(git fetch origin main)',
  'Bash(git rebase origin/main)',
  'Bash(git rebase --continue)',
  'Bash(git rebase --abort)',
]);

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
