// I gesti dello zoom visti dal main, dove la pagina non arriva: i tasti prima di lei, e il ponte fra i riquadri e il frame principale.
// Non zooma da sé: consegna tutto al preload del frame principale (src/preload/wheel-zoom.js), porta unica dello zoom.
// Regole: patterns/lo-zoom-lo-tiene-filo-non-la-pagina.md.

require('../../shared/zoomPagina');

function installZoom(wc) {
  const Z = globalThis.SN_ZOOM;
  if (!wc || !Z || typeof wc.on !== 'function') return;

  // Qui il tasto arriva prima del documento e di qualunque riquadro: un sito
  // non lo zittisce riscrivendosi, e un clic dentro un iframe non lo perde.
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const verso = Z.tastoZoom(input);
    if (!verso) return;
    event.preventDefault();
    try { wc.send('filo:zoom-key', verso); } catch (_) {}
  });

  // Ctrl+rotella che nessuno ha preso (un riquadro senza il nostro preload, un
  // ascoltatore spento da un documento riscritto). Chromium lo segnala qui anche
  // quando il preload l'ha già preso: decide lui se è un'eco (#686.1: ogni scatto
  // valeva due passi). Non sulle pagine di Filo, dove l'editor sceglie da sé.
  wc.on('zoom-changed', (_e, dir) => {
    let url = '';
    try { url = wc.getURL(); } catch (_) {}
    if (/^filo:/i.test(url)) return;
    try { wc.send('filo:zoom-rotella', dir === 'in' ? 'in' : 'out'); } catch (_) {}
  });

  if (!wc.ipc || typeof wc.ipc.on !== 'function') return;
  let modalita = false;
  const riquadri = () => {
    try { return wc.mainFrame.framesInSubtree.filter((f) => f !== wc.mainFrame); }
    catch (_) { return []; }
  };
  const principale = (e) => { try { return e.senderFrame === wc.mainFrame; } catch (_) { return false; } };

  // La modalità rotella la tiene il frame principale; i riquadri devono saperla
  // per fermare la rotella e i clic invece di lasciarli alla pagina.
  wc.ipc.on('filo:zoom-modalita', (e, on) => {
    if (!principale(e)) return;
    modalita = on === true;
    for (const f of riquadri()) { try { f.send('filo:zoom-modalita', modalita); } catch (_) {} }
  });
  wc.ipc.on('filo:zoom-ciao', (e) => {
    if (principale(e) || !e.senderFrame) return;
    try { e.senderFrame.send('filo:zoom-modalita', modalita); } catch (_) {}
  });
  wc.ipc.on('filo:zoom-gesto', (e, g) => {
    if (principale(e)) return;
    const gesto = Z.gestoValido(g);
    if (!gesto) return;
    try { wc.send('filo:zoom-gesto', gesto); } catch (_) {}
  });
  wc.on('did-navigate', () => { modalita = false; });
}

module.exports = { installZoom };
