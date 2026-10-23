// Le immagini lasciate sulla fila delle schede o sulla barra laterale (#1623) vanno alla chat della scheda davanti: qui
// si prendono, il main le legge e le consegna. Un rilascio che un pezzo della vista vuole per sé (defaultPrevented) resta suo.
// Regole: patterns/un-file-lasciato-dove-la-pagina-non-lo-vuole-va-alla-chat.md

(function (g) {
  'use strict';

  const immagine = (it) => it && it.kind === 'file' && /^image\//i.test(it.type || '');
  const conImmagini = (dt) => { try { return Array.from((dt && dt.items) || []).some(immagine); } catch (_) { return false; } };
  const leggi = (f) => new Promise((ok) => {
    try {
      const r = new FileReader();
      r.onload = () => ok(typeof r.result === 'string' ? r.result : '');
      r.onerror = () => ok('');
      r.readAsDataURL(f);
    } catch (_) { ok(''); }
  });

  // Dal disco basta il percorso; un'immagine senza file (da un'altra finestra) la si legge qui.
  async function voci(files, percorsoDi) {
    const out = [];
    for (const f of Array.from(files || []).filter((x) => /^image\//i.test(x.type || ''))) {
      let percorso = '';
      try { percorso = percorsoDi(f) || ''; } catch (_) { percorso = ''; }
      if (percorso) out.push({ nome: f.name || '', percorso });
      else {
        const dataUrl = await leggi(f);
        if (dataUrl) out.push({ nome: f.name || '', dataUrl });
      }
    }
    return out;
  }

  function ascolta(doc, { percorsoDi, manda }) {
    for (const tipo of ['dragenter', 'dragover']) {
      doc.addEventListener(tipo, (e) => {
        if (e.defaultPrevented || !conImmagini(e.dataTransfer)) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
      });
    }
    doc.addEventListener('drop', async (e) => {
      if (e.defaultPrevented || !conImmagini(e.dataTransfer)) return;
      e.preventDefault();
      const lista = await voci(e.dataTransfer.files, percorsoDi);
      if (lista.length) manda(lista);
    });
  }

  g.SN_RILASCIO_VISTA = { ascolta, voci };
})(typeof globalThis !== 'undefined' ? globalThis : self);
