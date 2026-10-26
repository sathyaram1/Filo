// Un trascinamento sulla pagina, contro il bordo alto o via da lì (#1343): a schermo intero chiama le schede.
// Il main vede il puntatore a tasto giù ma non distingue una selezione da un trascinamento; la pagina sì, coi suoi
// eventi veri. Ogni riquadro, anche di un altro sito: il bordo si misura sullo schermo, non sulla cima del riquadro.

const BORDO_PX = 2;
// Chi trascina genera un dragover ogni pochi millisecondi: basta dirlo ogni tanto, e il main sa che la pagina lo vede
// ancora (src/main/schedeInAlto.js: quando tace, decide il puntatore del sistema).
const OGNI_MS = 100;

module.exports = function ascoltaTrascinaBordo(win, ipcRenderer) {
  let principale = true;
  try { principale = win.top === win; } catch (_) { principale = false; }
  const dallaCima = (e) => (principale ? Number(e.clientY) : Number(e.screenY) - Number(win.screenY));
  let ultimo = null;
  let quando = 0;
  const manda = (stato) => {
    const ora = Date.now();
    if (stato !== 'fine' && ultimo === stato && ora - quando < OGNI_MS) return;
    ultimo = stato === 'fine' ? null : stato;
    quando = ora;
    try { ipcRenderer.send('filo:trascina-bordo', stato); } catch (_) {}
  };
  win.addEventListener('dragover', (e) => {
    if (!e.isTrusted) return;
    const y = dallaCima(e);
    manda(Number.isFinite(y) && y <= BORDO_PX ? 'bordo' : 'via');
  }, { capture: true, passive: true });
  for (const fine of ['drop', 'dragend']) {
    win.addEventListener(fine, (e) => { if (e.isTrusted) manda('fine'); }, { capture: true, passive: true });
  }
};
