// Il recupero di una scheda il cui processo è morto: si ricrea la vista, ma se muore di nuovo entro 2 s non si insiste,
// o si entra in un giro senza fine. Il fermo lascia una riga nel log del main e il conto ai contatori (#1479, #1466).
// Prova: tests/unit/guastiMuti.test.mjs.

'use strict';

const FERMO_MS = 2000;

// true: si ricrea la vista. Il tentativo si conta qui, così la riga del fermo dice quanti ce ne sono stati.
function recuperaScheda(tab, { motivo = '', incognito = false, adesso = Date.now() } = {}) {
  if (tab._crashRecoveryAt && adesso - tab._crashRecoveryAt < FERMO_MS) {
    const id = String(tab.id || '').slice(0, 6);
    console.warn(`[tab:${id}] recupero fermato: la pagina è morta di nuovo (${motivo || 'motivo ignoto'}) `
      + `entro ${FERMO_MS / 1000} s dal tentativo ${tab._crashRecuperi || 1}`);
    try { globalThis.SN_CONTATORI_MAIN?.processoMorto('scheda_in_recupero', motivo, { incognito: !!incognito }); } catch (_) {}
    return false;
  }
  tab._crashRecoveryAt = adesso;
  tab._crashRecuperi = (tab._crashRecuperi || 0) + 1;
  return true;
}

module.exports = { recuperaScheda, FERMO_MS };
