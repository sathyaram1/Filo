// Le immagini lasciate dove la pagina non accoglie il rilascio vanno alla chat di Filo (#1623); dove la pagina lo
// accoglie (un sito che carica file) vince lei, come in Chromium. Solo eventi veri: la pagina non fa leggere niente.
// Regole: patterns/un-file-lasciato-dove-la-pagina-non-lo-vuole-va-alla-chat.md

'use strict';

const conImmagini = (dt) => {
  try { return Array.from((dt && dt.items) || []).some((it) => it.kind === 'file' && /^image\//i.test(it.type || '')); } catch (_) { return false; }
};

const bersaglio = (e) => {
  const t = typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target;
  return t && t.nodeType === 1 ? t : null;
};
// Il campo file prende il rilascio da sé, senza che la pagina lo dica: lì Filo non si mette in mezzo.
const campoFile = (t) => !!t && t.localName === 'input' && String(t.type || '').toLowerCase() === 'file';

// `pronta()`: c'è una chat che lo prende; `consegna(files)`: le dà tutti i file lasciati, e lei dice cosa non entra;
// `pannello(t)`: il nodo sta nel pannello di Filo, e quello che gli si dà non passa dalla pagina.
// Il drop arriva alla pagina solo se lei ha accettato il passaggio, come in ogni browser (anche sopra una casella:
// un file non è testo); poi decide il drop, perché una pagina può accettare il passaggio e non prenderlo.
module.exports = function osservaRilascio(win, { pronta, consegna, pannello = () => false }) {
  // '' non è nostro, 'subito' lo prende Filo prima della pagina, 'dopo' solo se la pagina al drop non lo vuole.
  let nostro = '';
  let inAttesa = null;
  const delPannello = (e) => { try { return !!pannello(bersaglio(e)); } catch (_) { return false; } };
  // Nessuno ha accettato il passaggio: lo accetta Filo, e il drop la pagina non lo vede.
  const dopoLaPagina = (e) => {
    if (!nostro || e.defaultPrevented) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
    nostro = 'subito';
  };
  // Aggiunto mentre l'evento scende, l'ascolto in bolla arriva dopo quelli della pagina.
  const sopra = (e) => {
    nostro = '';
    if (!e.isTrusted || !conImmagini(e.dataTransfer) || campoFile(bersaglio(e))) return;
    try { if (!pronta()) return; } catch (_) { return; }
    nostro = 'dopo';
    win.addEventListener(e.type, dopoLaPagina, { once: true });
  };
  win.addEventListener('dragenter', sopra, true);
  win.addEventListener('dragover', sopra, true);
  const prendi = (e) => {
    e.preventDefault();
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (files.length) { try { consegna(files); } catch (_) {} }
  };
  const seLaPaginaNonLoVuole = (e) => {
    if (e !== inAttesa) return;
    inAttesa = null;
    if (!e.defaultPrevented) prendi(e);
  };
  // Accettato da Filo fuori da un campo, il rilascio non arriva alla pagina: i file erano per la chat.
  win.addEventListener('drop', (e) => {
    const mio = nostro;
    nostro = '';
    inAttesa = null;
    if (!e.isTrusted) return;
    if (delPannello(e)) {
      e.stopImmediatePropagation();
      prendi(e);
      return;
    }
    if (!mio) return;
    if (mio === 'dopo') {
      inAttesa = e;
      win.addEventListener('drop', seLaPaginaNonLoVuole, { once: true });
      return;
    }
    e.stopImmediatePropagation();
    prendi(e);
  }, true);
  // Un'immagine incollata nel pannello è per Filo: la pagina non la vede passare.
  win.addEventListener('paste', (e) => {
    if (!e.isTrusted || !delPannello(e)) return;
    let files = [];
    try {
      files = Array.from((e.clipboardData && e.clipboardData.items) || [])
        .filter((it) => it.kind === 'file' && /^image\//i.test(it.type || '')).map((it) => it.getAsFile()).filter(Boolean);
    } catch (_) { files = []; }
    if (!files.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try { consegna(files); } catch (_) {}
  }, true);
  // «Incolla» del menu di Filo manda l'immagine con un evento che attraversa il documento: lo script della pagina ne
  // leggerebbe il contenuto.
  win.addEventListener('filo:paste-image', (e) => {
    const blob = e.detail && e.detail.blob;
    if (!blob || !delPannello(e) || globalThis.SN_FILO_UI?.veroONostro?.(e) !== true) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try { consegna([blob]); } catch (_) {}
  }, true);
};
