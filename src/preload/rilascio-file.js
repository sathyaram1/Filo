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
// Una casella o un editor: il rilascio arriva alla pagina comunque, e solo al drop si vede se lo voleva (preventDefault).
const scrivibile = (t) => !!t && (!!t.isContentEditable || t.localName === 'input' || t.localName === 'textarea');

// `pronta()`: c'è una chat che lo prende; `consegna(files)`: le dà tutti i file lasciati, e lei dice cosa non entra.
// La pagina decide sul dragover, come per il browser: l'ultimo ascolto in bolla di window vede se l'ha voluto lei.
module.exports = function osservaRilascio(win, { pronta, consegna }) {
  // '' non è nostro, 'subito' lo prende Filo prima della pagina, 'dopo' solo se la pagina al drop non lo vuole.
  let nostro = '';
  let inAttesa = null;
  const dopoLaPagina = (e) => {
    const t = bersaglio(e);
    if (e.defaultPrevented || campoFile(t)) return;
    try { if (!pronta()) return; } catch (_) { return; }
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
    nostro = scrivibile(t) ? 'dopo' : 'subito';
  };
  // Aggiunto mentre l'evento scende, l'ascolto in bolla arriva dopo quelli della pagina.
  const sopra = (e) => {
    nostro = '';
    if (!e.isTrusted || !conImmagini(e.dataTransfer)) return;
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
    if (!mio || !e.isTrusted) return;
    if (mio === 'dopo') {
      inAttesa = e;
      win.addEventListener('drop', seLaPaginaNonLoVuole, { once: true });
      return;
    }
    e.stopImmediatePropagation();
    prendi(e);
  }, true);
};
