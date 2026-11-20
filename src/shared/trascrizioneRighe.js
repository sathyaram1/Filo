// Il testo di un'immagine letto dal modello, riga per riga col suo riquadro (#2374): lettura della risposta e scatole in
// pixel. Puro, senza DOM. Il prompt sta in SN_CONST.PROMPTS.transcribeImage; il disegno in src/content/trascrizione.js.

(function (global) {
  'use strict';

  const SCALA = 1000;
  // I formati che il lettore e lo strato sopra la scheda accettano: un altro (SVG, AVIF…) si ridisegna prima in JPEG.
  const IMMAGINE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
  const num = (v) => (typeof v === 'number' ? v : Number.parseFloat(String(v == null ? '' : v).replace(',', '.')));

  // Una riga col riquadro in 0..1, o senza (posizione null) se il modello non l'ha data o l'ha data rotta.
  function riga(o) {
    if (!o || typeof o !== 'object') return null;
    const testo = String(o.testo ?? o.text ?? o.t ?? '').replace(/\r/g, '');
    if (!testo.trim()) return null;
    let c = [o.x1, o.y1, o.x2, o.y2].map(num);
    if (!c.every(Number.isFinite) && Array.isArray(o.box || o.bbox || o.bbox_2d)) c = (o.box || o.bbox || o.bbox_2d).map(num);
    if (c.length !== 4 || !c.every(Number.isFinite)) return { testo, posizione: null };
    let [x1, y1, x2, y2] = c;
    if (x2 < x1) [x1, x2] = [x2, x1];
    if (y2 < y1) [y1, y2] = [y2, y1];
    const tieni = (v) => Math.min(1, Math.max(0, v / SCALA));
    const p = { x1: tieni(x1), y1: tieni(y1), x2: tieni(x2), y2: tieni(y2) };
    if (p.x2 - p.x1 <= 0 || p.y2 - p.y1 <= 0) return { testo, posizione: null };
    return { testo, posizione: p };
  }

  // La risposta del modello: JSON a righe, anche dentro un recinto ``` o tagliata al tetto di lunghezza (le righe intere
  // restano). Un modello che risponde in testo semplice dà righe senza posizione: il testo non si perde.
  function leggi(risposta) {
    const s = String(risposta == null ? '' : risposta).trim();
    if (!s) return { righe: [], conPosizioni: false };
    const inizio = s.indexOf('{');
    if (inizio >= 0) {
      let righe = null;
      const fine = s.lastIndexOf('}');
      if (fine > inizio) {
        try {
          const j = JSON.parse(s.slice(inizio, fine + 1));
          const lista = Array.isArray(j) ? j : (j && (j.righe || j.lines || j.righe_di_testo));
          if (Array.isArray(lista)) righe = lista.map(riga).filter(Boolean);
        } catch (_) { righe = null; }
      }
      // Tagliata a metà o con un pezzo rotto: si tengono gli oggetti interi, uno per uno.
      if (!righe) {
        const pezzi = s.slice(inizio).match(/\{[^{}]*\}/g) || [];
        righe = [];
        for (const p of pezzi) { try { const r = riga(JSON.parse(p)); if (r) righe.push(r); } catch (_) {} }
        if (!righe.length && /"(righe|testo|lines)"/.test(s)) return { righe: [], conPosizioni: false };
      }
      if (righe.length || /"righe"\s*:\s*\[\s*\]/.test(s)) {
        return { righe, conPosizioni: righe.length > 0 && righe.every((r) => r.posizione) };
      }
    }
    const semplice = s.replace(/^```[a-z]*\s*|\s*```$/gi, '');
    const righe = semplice.split('\n').filter((t) => t.trim()).map((testo) => ({ testo, posizione: null }));
    return { righe, conPosizioni: false };
  }

  // Le scatole in pixel su un'immagine larga w e alta h. Le righe senza posizione si mettono in colonna, ognuna su una
  // fascia uguale dell'altezza: il testo resta selezionabile e copiabile anche quando il modello non dice dove sta.
  function scatole(righe, w, h) {
    const lista = Array.isArray(righe) ? righe : [];
    const senza = lista.filter((r) => !r.posizione);
    const fascia = senza.length ? h / senza.length : 0;
    let i = 0;
    return lista.map((r) => {
      if (r.posizione) {
        const p = r.posizione;
        return { testo: r.testo, x: p.x1 * w, y: p.y1 * h, w: (p.x2 - p.x1) * w, h: (p.y2 - p.y1) * h };
      }
      const y = fascia * i++;
      return { testo: r.testo, x: 0, y, w, h: fascia, stimata: true };
    });
  }

  function testoIntero(righe) {
    return (Array.isArray(righe) ? righe : []).map((r) => r.testo).join('\n').trim();
  }

  global.SN_TRASCRIZIONE_RIGHE = { leggi, scatole, testoIntero, SCALA, IMMAGINE };
})(typeof globalThis !== 'undefined' ? globalThis : self);
