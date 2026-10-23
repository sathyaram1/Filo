// Un trascinamento portato contro il bordo alto della pagina, o via da lì (#1343): a schermo intero chiama le schede.
// Il main vede il puntatore a tasto giù ma non distingue una selezione da un trascinamento; la pagina sì, coi suoi
// eventi veri. Ogni riquadro, anche di un altro sito: il bordo si misura sullo schermo, non sulla cima del riquadro.

const BORDO_PX = 2;
// Chi trascina sopra la pagina genera un dragover ogni pochi millisecondi: si manda il cambio, e ogni tanto lo stato,
// perché un riquadro può aver detto «sul bordo» mentre questo documento diceva già «via» e non lo ripeterebbe.
const RIPETI_MS = 150;

module.exports = function ascoltaTrascinaBordo(win, ipcRenderer) {
  let principale = true;
  try { principale = win.top === win; } catch (_) { principale = false; }
  const dallaCima = (e) => (principale ? Number(e.clientY) : Number(e.screenY) - Number(win.screenY));
  let ultimo = null;
  let quando = 0;
  const manda = (sulBordo, sempre = false) => {
    const ora = Date.now();
    if (!sempre && ultimo === sulBordo && ora - quando < RIPETI_MS) return;
    ultimo = sulBordo;
    quando = ora;
    try { ipcRenderer.send('filo:trascina-bordo', sulBordo); } catch (_) {}
  };
  win.addEventListener('dragover', (e) => {
    if (!e.isTrusted) return;
    const y = dallaCima(e);
    manda(Number.isFinite(y) && y <= BORDO_PX);
  }, { capture: true, passive: true });
  for (const fine of ['drop', 'dragend']) {
    win.addEventListener(fine, (e) => { if (e.isTrusted) { manda(false, true); ultimo = null; } }, { capture: true, passive: true });
  }
};
