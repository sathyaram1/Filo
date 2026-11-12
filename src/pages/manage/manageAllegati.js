// Allegati delle caselle di risposta di Gestione (Domande, rombo, riapertura): tipi e tetti di SN_FEEDBACK_ATTACH,
// caricamento cifrato di SN_FEEDBACK, righe-allegato di SN_FEEDBACK_THREAD. Non manda niente: le righe le prende
// chi manda la risposta. Prove: tests/manage-domande-ciclo.spec.mjs.

(function () {
  'use strict';

  const RIPIEGO = { immagini: 5, file: 5, byte: 4 * 1024 * 1024 };

  function el(tag, cls, testo) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (testo !== undefined) e.textContent = String(testo);
    return e;
  }

  function fileDi(dt) {
    if (!dt) return [];
    const out = [];
    for (const it of Array.from(dt.items || [])) if (it.kind === 'file') { const f = it.getAsFile(); if (f) out.push(f); }
    if (!out.length) for (const f of Array.from(dt.files || [])) out.push(f);
    return out;
  }
  // Durante il trascinamento i file non si leggono ancora: basta sapere che ce ne sono.
  function portaFile(dt) {
    return !!dt && Array.from(dt.types || []).includes('Files');
  }

  /**
   * Una raccolta di allegati per chiave (una domanda, un feedback). `alCambio(chiave)` ridisegna chi la mostra;
   * `alMessaggio(chiave, testo)` dice un rifiuto o un guasto, '' quando non c'è più niente da dire.
   */
  function crea({ alCambio, alMessaggio } = {}) {
    const liste = new Map();
    const inCarico = new Map();
    const cambia = (k) => { if (typeof alCambio === 'function') alCambio(k); };
    const avvisa = (k, t) => { if (typeof alMessaggio === 'function') alMessaggio(k, t); };

    const di = (k) => (liste.get(k) || []).slice();
    const caricando = (k) => inCarico.get(k) || 0;

    function motivoRifiuto(k, file) {
      const AT = window.SN_FEEDBACK_ATTACH;
      const L = (AT && AT.LIMITI) || RIPIEGO;
      // Senza la lista condivisa il ripiego chiude: solo immagini raster.
      const tipo = AT && typeof AT.classify === 'function' ? AT.classify(file)
        : (/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(file.type || '') ? 'image' : null);
      if (!tipo) return (AT && AT.MESSAGGIO_TIPO) || 'Tipo di file non supportato.';
      const img = tipo === 'image';
      const gia = di(k).filter((a) => (a.kind === 'img') === img).length;
      if (img && gia >= L.immagini) return `Massimo ${L.immagini} immagini per risposta.`;
      if (!img && gia >= L.file) return `Massimo ${L.file} file per risposta.`;
      if (file.size > L.byte) return `«${file.name || 'file'}» è troppo grande (massimo ${Math.round(L.byte / 1024 / 1024)} MB).`;
      const FB = window.SN_FEEDBACK;
      if (!FB || typeof FB.uploadAttachment !== 'function') return 'Il caricamento degli allegati non è disponibile qui.';
      return '';
    }

    async function aggiungi(k, files) {
      for (const file of Array.from(files || [])) {
        const no = motivoRifiuto(k, file);
        if (no) { avvisa(k, no); continue; }
        inCarico.set(k, caricando(k) + 1);
        cambia(k);
        try {
          const att = await window.SN_FEEDBACK.uploadAttachment(file, file.name);
          if (att && att.url) liste.set(k, di(k).concat([att]));
          avvisa(k, '');
        } catch (e) {
          const FB = window.SN_FEEDBACK;
          const cifratura = !!(FB && typeof FB.isEncryptionError === 'function' && FB.isEncryptionError(e));
          avvisa(k, cifratura ? String(e.message) : `Allegato non caricato: ${(e && e.message) || e}`);
        } finally {
          const n = caricando(k) - 1;
          if (n > 0) inCarico.set(k, n); else inCarico.delete(k);
          cambia(k);
        }
      }
    }

    function togli(k, i) {
      const lista = di(k);
      lista.splice(i, 1);
      if (lista.length) liste.set(k, lista); else liste.delete(k);
      cambia(k);
    }

    function svuota(k) { liste.delete(k); }

    // Le righe-marcatore che partono col testo: il server le apre per chi riprende.
    function righe(k) {
      const TH = window.SN_FEEDBACK_THREAD;
      return TH && typeof TH.attachmentsBlock === 'function' ? TH.attachmentsBlock(di(k)) : '';
    }

    /** La riga sotto la casella: un gettone per allegato, «+ Allega» e il selettore nascosto. */
    function riga(k, { disabilitata = false } = {}) {
      const box = el('div', 'mg-dq-allegati');
      box.dataset.chiave = k;
      let immagini = 0;
      di(k).forEach((a, i) => {
        if (a.kind === 'img') immagini += 1;
        const chip = el('span', 'mg-dq-allegato', a.kind === 'img' ? `Immagine ${immagini}` : (a.name || 'allegato'));
        chip.title = a.name || '';
        const x = el('button', 'mg-dq-allegato-x', '×');
        x.type = 'button';
        x.title = 'Togli';
        x.setAttribute('aria-label', `Togli ${a.name || 'l’allegato'}`);
        x.disabled = disabilitata;
        x.addEventListener('click', () => togli(k, i));
        chip.appendChild(x);
        box.appendChild(chip);
      });
      const b = el('button', 'sn-btn sn-btn-secondary mg-dq-allega', caricando(k) ? 'Caricamento…' : '+ Allega');
      b.type = 'button';
      b.title = 'Immagini o file per chi riprende il lavoro; puoi anche incollarli o trascinarli nel testo';
      b.disabled = disabilitata || !!caricando(k);
      const input = el('input', 'mg-dq-file');
      input.type = 'file';
      input.multiple = true;
      input.accept = (window.SN_FEEDBACK_ATTACH && window.SN_FEEDBACK_ATTACH.ACCEPT) || 'image/png,image/jpeg,image/gif,image/webp,image/bmp';
      input.hidden = true;
      b.addEventListener('click', () => { try { input.click(); } catch (_) {} });
      input.addEventListener('change', () => {
        const scelti = Array.from(input.files || []);
        input.value = '';
        if (scelti.length) aggiungi(k, scelti);
      });
      box.append(b, input);
      return box;
    }

    /**
     * Incolla e trascina sulla casella: un file diventa un allegato, il testo resta testo. `chiave` è una funzione
     * quando la casella resta e cambia ciò a cui risponde.
     */
    function collega(casella, chiave) {
      if (!casella || casella.dataset.mgAllegati) return;
      casella.dataset.mgAllegati = '1';
      const k = () => (typeof chiave === 'function' ? chiave() : chiave);
      casella.addEventListener('paste', (e) => {
        const files = fileDi(e.clipboardData);
        if (!files.length || !k()) return;
        e.preventDefault();
        aggiungi(k(), files);
      });
      casella.addEventListener('dragover', (e) => {
        if (!portaFile(e.dataTransfer) || casella.disabled) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        casella.classList.add('mg-allegati-sopra');
      });
      casella.addEventListener('dragleave', () => casella.classList.remove('mg-allegati-sopra'));
      casella.addEventListener('drop', (e) => {
        casella.classList.remove('mg-allegati-sopra');
        const files = fileDi(e.dataTransfer);
        if (!files.length || !k() || casella.disabled) return;
        e.preventDefault();
        aggiungi(k(), files);
      });
    }

    return { aggiungi, togli, svuota, di, caricando, righe, riga, collega };
  }

  window.SN_MG_ALLEGATI = { crea };
})();
