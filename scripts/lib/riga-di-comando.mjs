// Lotti di argomenti che stanno in UNA riga di comando di Windows: cmd.exe (npx, `shell: true`) regge 8.191
// caratteri, CreateProcess (un eseguibile lanciato diretto) 32.767. Nessun argomento si perde e l'ordine resta.
// Sentinelle: tests/unit/unitRunner.test.mjs e tests/unit/finishLocal.test.mjs.

/**
 * `fisso` sono i caratteri già occupati (eseguibile, flag), `costo` quanto occupa una voce con il suo separatore. PURA.
 * Una voce più lunga del tetto va da sola: il rifiuto lo dà il sistema col suo errore, invece di sparire qui.
 */
export function lottiPerRigaDiComando(voci, maxChars = 6000, { fisso = 0, costo = (s) => s.length + 1 } = {}) {
  const spazio = maxChars - fisso;
  const lotti = [];
  let corrente = [], lunghezza = 0;
  for (const s of voci) {
    const pezzo = costo(s);
    if (corrente.length && lunghezza + pezzo > spazio) { lotti.push(corrente); corrente = []; lunghezza = 0; }
    corrente.push(s); lunghezza += pezzo;
  }
  if (corrente.length) lotti.push(corrente);
  return lotti;
}

/** Quanto occupa un argomento nella riga che libuv compone su Windows: virgolette e spazio compresi, per eccesso. PURA. */
export function costoArgomentoWindows(arg) {
  const s = String(arg);
  // Ogni " prende una barra davanti, e le barre prima di una " o della fine raddoppiano: una in più per ciascuna al massimo.
  return s.length + 3 + (s.match(/["\\]/g) || []).length;
}
