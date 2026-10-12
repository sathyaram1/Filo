// Cmd+freccia su Mac (#685.1): la pagina ha il tasto per prima, come in Safari e Chrome; si naviga
// solo se non l'ha usato e non ci si scrive. Gira in ogni frame (il campo può stare in un riquadro);
// piattaforma e passo li decide il main, che accetta solo un tasto che ha visto passare.
const path = require('node:path');

module.exports = function ascoltaCmdFreccia(win, ipcRenderer) {
  const campoTesto = () => {
    if (!globalThis.SN_CAMPO_TESTO) {
      try { require(path.join(__dirname, '..', 'shared', 'campoTesto.js')); } catch (_) {}
    }
    return globalThis.SN_CAMPO_TESTO;
  };
  win.addEventListener('keydown', (e) => {
    if (!e.isTrusted || !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const verso = e.key === 'ArrowLeft' ? 'indietro' : e.key === 'ArrowRight' ? 'avanti' : null;
    if (!verso) return;
    // Dopo tutti gli ascoltatori della pagina: solo allora `defaultPrevented` dice se l'ha usato.
    setTimeout(() => {
      if (e.defaultPrevented) return;
      const ct = campoTesto();
      if (!ct || ct.scriveQui(win.document) !== false) return;
      try { ipcRenderer.send('filo:cmd-freccia', verso); } catch (_) {}
    }, 0);
  }, true);
};
