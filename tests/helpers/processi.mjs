// Processi per le prove: un pid che non appartiene a nessun processo, senza lanciarne uno. Il pid di un figlio appena
// uscito non basta: sotto carico il lancio fallisce prima che il figlio scriva (0xC0000142) o il pid torna in uso (#1063).
// Sentinella: tests/unit/tempiSottoCarico.test.mjs.

/** Un pid che adesso nessun processo ha: si parte dall'alto, dove i sistemi non assegnano pid, e si scende finché è libero. */
export function pidMorto() {
  for (let pid = 2 ** 31 - 4; pid > 4; pid -= 4) {
    try { process.kill(pid, 0); } catch (e) { if (e && e.code === 'ESRCH') return pid; }
  }
  throw new Error('nessun pid libero');
}
