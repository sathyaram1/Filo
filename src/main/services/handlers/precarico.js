// Handler del precarico dei link (#1985): se i link a schermo possono partire adesso. Aperto ai siti di proposito: lo
// chiede il content script della pagina, e risponde solo sì o no col motivo. Le regole: src/shared/precarico.js.

// La spina la sa il lettore dello stato del sistema, che su Linux la legge dai file.
function sullaBatteria() {
  if (!globalThis.SN_SISTEMA_MAIN) require('../statoSistema');
  return !!globalThis.SN_SISTEMA_MAIN.sullaBatteria();
}

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
    const tm = win && win._filoTabs;
    let dietro = false;
    try {
      const davanti = tm && Array.isArray(tm.tabs) ? tm.tabs.find((t) => t && t.id === tm.activeId) : null;
      dietro = !!(sender && sender.wc) && (!davanti || !davanti.view || davanti.view.webContents !== sender.wc || win.isMinimized());
    } catch (_) {}
    const motivo = globalThis.SN_PRECARICO.motivoFermoVisibili({
      impostazioni, incognito: !!(tm && tm.incognito), scaricando, aBatteria, dietro,
    });
    return { ok: true, visibili: !motivo, motivo };
  });
};
