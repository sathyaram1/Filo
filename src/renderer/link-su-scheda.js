// Un collegamento trascinato sulla fila delle schede (#2393), come in Chrome: sul centro di una scheda la porta lì, sul
// suo quarto di bordo, dopo l'ultima o sul «+» ne apre una nuova in quel posto. Sulla parte vuota della fila
// un'immagine resta della chat (src/renderer/rilascio.js). Il main accetta solo indirizzi del web (src/main/linkSuScheda.js).

(function (g) {
  'use strict';

  const tipi = (dt) => { try { return Array.from((dt && dt.types) || []); } catch (_) { return []; } };
  // Più di un indirizzo arriva solo da altre app: Chrome apre il primo, e così qui.
  function primoIndirizzo(uriList, testo) {
    for (const riga of String(uriList || '').split(/\r?\n/)) {
      const r = riga.trim();
      if (r && !r.startsWith('#')) return r;
    }
    return String(testo || '').trim();
  }

  // Durante il passaggio si leggono solo i tipi: il contenuto arriva al rilascio.
  function bersaglio(e, { fila, schede, nuova }) {
    const t = e.target;
    if (!(t instanceof Node) || !fila.contains(t)) return null;
    const dt = e.dataTransfer;
    const ti = tipi(dt);
    if (!ti.includes('text/uri-list')) return null;
    const elenco = [...schede.querySelectorAll('.tab[data-id]')];
    const scheda = t instanceof Element ? t.closest('.tab[data-id]') : null;
    if (scheda && schede.contains(scheda)) {
      const r = scheda.getBoundingClientRect();
      const i = elenco.indexOf(scheda);
      const quarto = r.width / 4;
      if (e.clientX < r.left + quarto) return { indice: i };
      if (e.clientX > r.right - quarto) return { indice: i + 1 };
      return { scheda };
    }
    if (schede.contains(t) || (nuova && nuova.contains(t))) return { indice: elenco.length };
    // Un'immagine di una pagina porta anche il suo file: lasciata dove non c'è una scheda va alla chat, come prima.
    if (ti.includes('Files')) return null;
    return { indice: elenco.length };
  }

  function ascolta(doc, { fila, schede, nuova, manda }) {
    if (!fila || !schede || typeof manda !== 'function') return;
    const segno = doc.createElement('div');
    segno.className = 'link-posto';
    segno.hidden = true;
    doc.body.appendChild(segno);
    let sopra = null;
    let scade = null;

    function pulisci() {
      if (sopra) { sopra.classList.remove('link-sopra'); sopra = null; }
      segno.hidden = true;
      if (scade) { clearTimeout(scade); scade = null; }
    }

    function mostra(b) {
      const el = b.scheda || null;
      if (sopra !== el) { if (sopra) sopra.classList.remove('link-sopra'); sopra = el; if (el) el.classList.add('link-sopra'); }
      if (el) { segno.hidden = true; return; }
      const elenco = [...schede.querySelectorAll('.tab[data-id]')];
      const fr = schede.getBoundingClientRect();
      let x;
      if (b.indice < elenco.length) x = elenco[b.indice].getBoundingClientRect().left;
      else if (elenco.length) x = elenco[elenco.length - 1].getBoundingClientRect().right;
      else x = fr.left;
      const riga = (elenco[0] || schede).getBoundingClientRect();
      x = Math.max(fr.left, Math.min(fr.right, x));
      segno.style.left = `${Math.round(x - 1)}px`;
      segno.style.top = `${Math.round(riga.top + 4)}px`;
      segno.style.height = `${Math.max(12, Math.round(riga.height - 8))}px`;
      segno.hidden = false;
    }

    function passa(e) {
      if (!e.isTrusted) return;
      const b = bersaglio(e, { fila, schede, nuova });
      if (!b) { pulisci(); return; }
      e.preventDefault();
      try {
        const ammessi = String(e.dataTransfer.effectAllowed || '');
        e.dataTransfer.dropEffect = /link|all|uninitialized/i.test(ammessi) ? 'link' : 'copy';
      } catch (_) {}
      mostra(b);
      // Uscita verso la pagina: è un'altra vista, e qui non arriva niente. Il dragleave di Chromium non dice verso dove.
      if (scade) clearTimeout(scade);
      scade = setTimeout(pulisci, 300);
    }
    doc.addEventListener('dragenter', passa, true);
    doc.addEventListener('dragover', passa, true);
    doc.addEventListener('dragend', pulisci, true);
    doc.addEventListener('drop', (e) => {
      if (!e.isTrusted) return;
      const b = bersaglio(e, { fila, schede, nuova });
      pulisci();
      if (!b) return;
      let url = '';
      try { url = primoIndirizzo(e.dataTransfer.getData('text/uri-list'), e.dataTransfer.getData('text/plain')); } catch (_) {}
      if (!url) return;
      e.preventDefault();
      e.stopPropagation();
      if (b.scheda) manda({ url, id: b.scheda.dataset.id });
      else manda({ url, indice: b.indice });
    }, true);
  }

  g.SN_LINK_SU_SCHEDA = { ascolta, primoIndirizzo, bersaglio };
})(typeof globalThis !== 'undefined' ? globalThis : self);
