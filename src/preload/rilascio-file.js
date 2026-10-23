// Le immagini lasciate dove la pagina non accoglie il rilascio vanno alla chat di Filo (#1623); dove la pagina lo
// accoglie (un sito che carica file) vince lei, come in Chromium. Solo eventi veri: la pagina non fa leggere niente.
// Regole: patterns/un-file-lasciato-dove-la-pagina-non-lo-vuole-va-alla-chat.md

'use strict';

const conImmagini = (dt) => {
  try { return Array.from((dt && dt.items) || []).some((it) => it.kind === 'file' && /^image\//i.test(it.type || '')); } catch (_) { return false; }
};

// Un campo prende il rilascio da sé, senza che la pagina lo dica: il campo file lo carica, un editor lo scrive.
const campo = (e) => {
  const t = typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target;
  if (!t || t.nodeType !== 1) return false;
  return !!t.isContentEditable || t.localName === 'input' || t.localName === 'textarea';
};

// `pronta()`: c'è una chat che lo prende; `consegna(files)`: gliele dà. La pagina decide sul dragover, come per il
// browser: l'ultimo ascolto in bolla di window vede se l'ha voluto lei, e solo allora Filo lo accetta.
module.exports = function osservaRilascio(win, { pronta, consegna }) {
  let nostro = false;
  const dopoLaPagina = (e) => {
    if (e.defaultPrevented || campo(e)) return;
    try { if (!pronta()) return; } catch (_) { return; }
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
    nostro = true;
  };
  // Aggiunto mentre l'evento scende, l'ascolto in bolla arriva dopo quelli della pagina.
  const sopra = (e) => {
    nostro = false;
    if (!e.isTrusted || !conImmagini(e.dataTransfer)) return;
    win.addEventListener(e.type, dopoLaPagina, { once: true });
  };
  win.addEventListener('dragenter', sopra, true);
  win.addEventListener('dragover', sopra, true);
  // Accettato da Filo, il rilascio non arriva alla pagina: i file erano per la chat.
  win.addEventListener('drop', (e) => {
    const mio = nostro;
    nostro = false;
    if (!mio || !e.isTrusted) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => /^image\//i.test(f.type || ''));
    if (files.length) { try { consegna(files); } catch (_) {} }
  }, true);
};
