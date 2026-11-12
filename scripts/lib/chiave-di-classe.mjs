// La chiave di classe letta dall'ambiente, per domanda.mjs e manutentore.mjs (#2015). L'ordine è una regola sola:
// la chiave owner-non-fidato (i poteri del manutentore più le domande, #2011) prima di quella del manutentore.
// Prove: tests/unit/chiaveDiClasse.test.mjs.

export const CHIAVI = Object.freeze([
  Object.freeze({ classe: 'owner-non-fidato', variabile: 'FILO_OWNER_NON_FIDATO_KEY' }),
  Object.freeze({ classe: 'manutentore', variabile: 'FILO_MANUTENTORE_KEY' }),
]);

/** La prima chiave non vuota nell'ordine di CHIAVI, o null. PURA. @returns {{ passphrase, classe, variabile } | null} */
export function chiaveDallAmbiente(env = {}) {
  const e = env && typeof env === 'object' ? env : {};
  for (const c of CHIAVI) {
    const k = String(e[c.variabile] || '').trim();
    if (k) return { passphrase: k, classe: c.classe, variabile: c.variabile };
  }
  return null;
}

/** Come si ottiene la chiave di una classe, per i rifiuti. PURA. */
export const comeCrearla = (classe) => `la crea l'owner con node scripts/routine-keys.mjs crea <nome> ${classe}`;
