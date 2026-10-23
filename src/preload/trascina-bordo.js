// Un trascinamento portato contro il bordo alto della pagina, o via da lì (#1343): a schermo intero chiama le schede.
// Il main vede il puntatore a tasto giù ma non distingue una selezione da un trascinamento; la pagina sì, coi suoi
// eventi veri. Solo il frame principale: il bordo di un riquadro a metà pagina non è il bordo dello schermo.

const BORDO_PX = 2;

module.exports = function ascoltaTrascinaBordo(win, ipcRenderer) {
  try { if (win.top !== win) return; } catch (_) { return; }
  // Si manda solo il cambio: chi trascina sopra la pagina genera un dragover ogni pochi millisecondi.
  let ultimo = null;
  const manda = (sulBordo) => {
    if (ultimo === sulBordo) return;
    ultimo = sulBordo;
    try { ipcRenderer.send('filo:trascina-bordo', sulBordo); } catch (_) {}
  };
  win.addEventListener('dragover', (e) => {
    if (e.isTrusted) manda(Number(e.clientY) <= BORDO_PX);
  }, { capture: true, passive: true });
  for (const fine of ['drop', 'dragend']) {
    win.addEventListener(fine, (e) => { if (e.isTrusted) { manda(false); ultimo = null; } }, { capture: true, passive: true });
  }
};
