// Handler del precarico dei link (#1985): se i link a schermo possono partire adesso. Aperto ai siti di proposito: lo
// chiede il content script della pagina, e risponde solo sì o no col motivo. Le regole: src/shared/precarico.js.

const { powerMonitor } = require('electron');

module.exports = function register(on, ctx) {
  const { MSG, winOf } = ctx;
  const Storage = globalThis.SN_STORAGE;

  on(MSG.PRECARICO_STATO, async (msg, sender) => {
    let impostazioni = null;
    try { impostazioni = await Storage.getSettings(); } catch (_) {}
    const win = winOf(sender);
    let scaricando = false;
    try { scaricando = require('../downloads').scaricaInCorso(); } catch (_) {}
    let aBatteria = false;
    try { aBatteria = powerMonitor.isOnBatteryPower(); } catch (_) {}
    const motivo = globalThis.SN_PRECARICO.motivoFermoVisibili({
      impostazioni, incognito: !!(win && win._filoTabs && win._filoTabs.incognito), scaricando, aBatteria,
    });
    return { ok: true, visibili: !motivo, motivo };
  });
};
