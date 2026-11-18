// I file con cui Actions raccoglie uscite, ambiente e PATH dei passi dopo: li tiene solo lo strumento di main che scrive
// l'esito, mai il codice del ramo provato (#2225, #2558). Solo moduli di Node. Sentinella: tests/unit/comandiDiActions.test.mjs.

export const COMANDI_DI_ACTIONS = Object.freeze(['GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_PATH', 'GITHUB_STATE', 'GITHUB_STEP_SUMMARY']);

/** PURA. */
export function senzaComandiDiActions(env) {
  const e = { ...env };
  for (const k of COMANDI_DI_ACTIONS) delete e[k];
  return e;
}

/** Li toglie da `env` (di norma quello del processo, che i figli ereditano: git, hook, prove) e li dà a chi scrive l'esito. */
export function prendiComandiDiActions(env = process.env) {
  const presi = {};
  for (const k of COMANDI_DI_ACTIONS) {
    if (env[k] !== undefined) presi[k] = env[k];
    delete env[k];
  }
  return presi;
}
