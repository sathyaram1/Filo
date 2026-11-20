// Il testo di un'immagine letto dal modello, riga per riga col suo riquadro (#2374): lettura della risposta, scatole in
// pixel e dove cadono le parole nei pixel della riga. Puro, senza DOM. Il prompt sta in SN_CONST.PROMPTS.transcribeImage; il disegno in src/content/trascrizione.js.

(function (global) {
  'use strict';

  const SCALA = 1000;
  // Sotto questo stacco (grigi 0..255) fra le due classi della soglia, nel riquadro non c'è una scritta da misurare.
  const STACCO_INCHIOSTRO = 40;
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

  // Quanto inchiostro ha ogni colonna del riquadro `r` (pixel) in un'immagine in grigi `luma` (w per h). L'inchiostro è
  // la classe minoritaria della soglia di Otsu, chiaro o scuro che sia; null senza stacco fra scritta e fondo.
  function inchiostro(luma, w, h, r) {
    if (!luma || !r) return null;
    const dentro = (v, max) => Math.min(max, Math.max(0, v));
    const x0 = dentro(Math.floor(r.x), w);
    const x1 = dentro(Math.ceil(r.x + r.w), w);
    const y0 = dentro(Math.floor(r.y), h);
    const y1 = dentro(Math.ceil(r.y + r.h), h);
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;
    const ist = new Float64Array(256);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ist[luma[y * w + x]] += 1;
    const tutti = (x1 - x0) * (y1 - y0);
    let sommaTutti = 0;
    for (let i = 0; i < 256; i++) sommaTutti += i * ist[i];
    let c0 = 0;
    let s0 = 0;
    let meglio = { v: -1, t: 0, m0: 0, m1: 0, c0: 0 };
    for (let t = 0; t < 255; t++) {
      c0 += ist[t];
      s0 += t * ist[t];
      const c1 = tutti - c0;
      if (!c0 || !c1) continue;
      const m0 = s0 / c0;
      const m1 = (sommaTutti - s0) / c1;
      const v = c0 * c1 * (m0 - m1) * (m0 - m1);
      if (v > meglio.v) meglio = { v, t, m0, m1, c0 };
    }
    if (meglio.v < 0 || meglio.m1 - meglio.m0 < STACCO_INCHIOSTRO) return null;
    const scuro = meglio.c0 <= tutti - meglio.c0;
    const colonne = new Uint16Array(x1 - x0);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const v = luma[y * w + x];
        if (scuro ? v <= meglio.t : v > meglio.t) colonne[x - x0] += 1;
      }
    }
    return { da: x0, colonne, alta: y1 - y0 };
  }

  // Dove sono disegnate le parole di `testo`, dalle colonne di `inchiostro`: [{ da, a }] in pixel (a esclusa), una per
  // parola. Gli spazi sono i buchi più larghi; null se non si contano in modo univoco (meno buchi delle parole, o il
  // primo buco escluso largo quanto l'ultimo preso), e chi disegna resta sul testo stirato sulla riga.
  function parole(testo, ink) {
    const n = String(testo == null ? '' : testo).trim().split(/\s+/).filter(Boolean).length;
    if (!ink || !n) return null;
    const { colonne, da, alta } = ink;
    const soglia = Math.floor(alta * 0.03);
    const vuota = (x) => colonne[x] <= soglia;
    let primo = 0;
    while (primo < colonne.length && vuota(primo)) primo++;
    let ultimo = colonne.length - 1;
    while (ultimo >= primo && vuota(ultimo)) ultimo--;
    if (primo > ultimo) return null;
    const buchi = [];
    for (let x = primo; x <= ultimo;) {
      if (!vuota(x)) { x++; continue; }
      const s = x;
      while (x <= ultimo && vuota(x)) x++;
      buchi.push({ s, e: x, l: x - s });
    }
    if (buchi.length < n - 1) return null;
    const larghi = [...buchi].sort((p, q) => q.l - p.l);
    const presi = larghi.slice(0, n - 1).sort((p, q) => p.s - q.s);
    if (n > 1 && larghi[n - 1] && larghi[n - 1].l >= larghi[n - 2].l) return null;
    const out = [];
    let inizio = primo;
    for (const b of presi) { out.push({ da: da + inizio, a: da + b.s }); inizio = b.e; }
    out.push({ da: da + inizio, a: da + ultimo + 1 });
    return out;
  }

  global.SN_TRASCRIZIONE_RIGHE = { leggi, scatole, testoIntero, inchiostro, parole, SCALA };
})(typeof globalThis !== 'undefined' ? globalThis : self);
