// Attese su un fatto, non su un tempo: per i processi e i file veri, che sotto carico arrivano quando arrivano.
// Il tetto c'è solo perché una prova rotta finisca con un rosso che dice cosa non è successo, non appesa (#1063).

export const TETTO_ATTESA_MS = 5 * 60 * 1000;

/** Aspetta che `condizione()` (anche asincrona) sia vera, guardando ogni `ogniMs`. Oltre il tetto lancia, col `cosa`. */
export async function aspettaChe(condizione, { cosa = 'la condizione attesa', ogniMs = 50, oltreMs = TETTO_ATTESA_MS } = {}) {
  const fine = Date.now() + oltreMs;
  for (;;) {
    if (await condizione()) return;
    if (Date.now() >= fine) throw new Error(`${cosa}: non è successo in ${Math.round(oltreMs / 1000)} s`);
    await new Promise((ok) => setTimeout(ok, ogniMs));
  }
}
