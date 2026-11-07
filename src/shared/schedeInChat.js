// Le schede lasciate in una chat di Filo (#2085): un gettone in linea col testo, che nel testo è `⟦ titolo⟧` e accanto
// porta { id, titolo, url, icona }. Qui la forma dei dati (anche per il main), il campo coi gettoni e la bolla del filo.
// Il campo resta un textarea: i gettoni li disegna un fondo che ricalca il testo, così cursore e Backspace restano suoi.

(function (global) {
  'use strict';

  const APRE = '⟦';
  const CHIUDE = '⟧';
  // Lo spazio em è largo quanto la riga è alta: lì il fondo posa l'icona del sito.
  const POSTO = ' ';
  const RE = /⟦ ([^⟦⟧\n]*)⟧/g;
  const LUNGO = 28;
  // Una chat con più schede di così è un errore di mano, non una domanda: il campo lo dice e non ne prende altre.
  const MASSIMO = 12;

  const testo = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f⟦⟧]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  function sitoDi(url) {
    try { return new URL(url).hostname.replace(/^www\./i, ''); } catch (_) { return ''; }
  }

  // Quello che viaggia fra pagina e main, ripulito da tutte e due le parti: indirizzi solo web, icona solo i byte già
  // scaricati dal main (data:), così mostrare un gettone non contatta il sito. I formati sono quelli che il main riconosce
  // nell'icona di una scheda (src/main/services/iconaScheda.js): un svg sta in un <img>, dove i suoi script non girano.
  const ICONA = /^data:image\/(png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|bmp|avif|svg\+xml);base64,/i;
  function normalizza(s) {
    if (!s || typeof s !== 'object') return null;
    const url = typeof s.url === 'string' && /^https?:\/\//i.test(s.url) && s.url.length <= 4096 ? s.url : '';
    const titolo = testo(s.titolo, 300) || sitoDi(url);
    if (!url || !titolo) return null;
    const icona = typeof s.icona === 'string' && s.icona.length <= 200000 && ICONA.test(s.icona) ? s.icona : '';
    const id = typeof s.id === 'string' && /^[\w-]{1,80}$/.test(s.id) ? s.id : '';
    return { id, titolo, url, icona };
  }

  // Le schede di un messaggio come si salvano col filo (home e righe delle app): ripulite, al più MASSIMO, senza le
  // icone grosse. Un solo posto per tutte le strade che scrivono un messaggio su disco.
  function perIlDisco(lista) {
    return (Array.isArray(lista) ? lista : []).slice(0, MASSIMO).map(normalizza).filter(Boolean)
      .map((s) => (s.icona.length > 16384 ? { ...s, icona: '' } : s));
  }

  function etichetta(s) {
    const t = testo(s && s.titolo, 300) || sitoDi(s && s.url) || '';
    return t.length > LUNGO ? `${t.slice(0, LUNGO - 1).trimEnd()}…` : t;
  }
  const gettone = (s) => `${APRE}${POSTO}${etichetta(s)}${CHIUDE}`;

  // Il testo a pezzi: { testo } e { gettone, etichetta, da, a }, nell'ordine.
  function pezzi(t) {
    const out = [];
    const s = String(t || '');
    let ultimo = 0;
    RE.lastIndex = 0;
    let m;
    while ((m = RE.exec(s))) {
      if (m.index > ultimo) out.push({ testo: s.slice(ultimo, m.index) });
      out.push({ gettone: m[0], etichetta: m[1], da: m.index, a: m.index + m[0].length });
      ultimo = m.index + m[0].length;
    }
    if (ultimo < s.length) out.push({ testo: s.slice(ultimo) });
    return out;
  }

  // Le schede che il testo porta ancora, nell'ordine dei gettoni: un gettone cancellato o scritto a mano non ne ha una.
  function allinea(t, schede) {
    const resto = (Array.isArray(schede) ? schede : []).map(normalizza).filter(Boolean);
    const out = [];
    for (const p of pezzi(t)) {
      if (!p.gettone) continue;
      const i = resto.findIndex((s) => etichetta(s) === p.etichetta);
      out.push(i >= 0 ? resto.splice(i, 1)[0] : null);
    }
    return out;
  }

  // ── Pagina ──────────────────────────────────────────────────────────────

  const CSS = `
.sn-gettoni-fondo { position: absolute; pointer-events: none; overflow: hidden; box-sizing: border-box;
  white-space: pre-wrap; overflow-wrap: break-word; word-wrap: break-word; border-style: solid; border-color: transparent; margin: 0; }
.sn-con-gettoni { color: transparent !important; background: transparent !important; position: relative; z-index: 1; }
.sn-con-gettoni::placeholder { color: transparent; }
.sn-gettone { border-radius: 6px; background: color-mix(in srgb, var(--accent, #c8743c) 16%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, #c8743c) 16%, transparent); }
.sn-gettoni-fondo .sn-gettone .sn-gettone-segno { color: transparent; }
.sn-gettone.sopra { background: color-mix(in srgb, var(--accent, #c8743c) 28%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, #c8743c) 28%, transparent); }
.sn-gettone-posto { position: relative; display: inline-block; width: 1em; }
.sn-gettone-posto img, .sn-gettone-posto i { position: absolute; left: 0.08em; top: 50%; width: 0.84em; height: 0.84em;
  transform: translateY(-50%); border-radius: 3px; object-fit: contain; }
.sn-gettone-posto i { background: color-mix(in srgb, currentColor 30%, transparent); }
.sn-bolla-gettone { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 0 6px; margin: 0 1px;
  border-radius: 6px; vertical-align: baseline; cursor: pointer; font-weight: 600;
  background: color-mix(in srgb, var(--accent, #c8743c) 16%, transparent);
  transition: background calc(0.12s * var(--sn-motion, 1)) ease; }
.sn-bolla-gettone:hover { background: color-mix(in srgb, var(--accent, #c8743c) 30%, transparent); }
.sn-bolla-gettone img, .sn-bolla-gettone i { width: 14px; height: 14px; border-radius: 3px; flex: none; object-fit: contain; }
.sn-bolla-gettone i { background: color-mix(in srgb, currentColor 30%, transparent); }
.sn-bolla-gettone span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

  function stile(radice) {
    const dove = radice && radice.nodeType === 11 ? radice : (radice && radice.head) || document.head;
    if (!dove || dove.querySelector?.('style[data-sn-gettoni]')) return;
    const st = (radice && radice.ownerDocument ? radice.ownerDocument : document).createElement('style');
    st.dataset.snGettoni = '1';
    st.textContent = CSS;
    dove.appendChild(st);
  }

  function icona(doc, s) {
    if (s && s.icona) {
      const img = doc.createElement('img');
      img.alt = '';
      img.src = s.icona;
      img.addEventListener('error', () => img.replaceWith(doc.createElement('i')), { once: true });
      return img;
    }
    return doc.createElement('i');
  }

  // Il campo coi gettoni. `azioni`: { anteprima(scheda, rect), nascondi(), apri(scheda), troppe(n) }.
  function campo(ta, azioni = {}) {
    if (!ta || ta._snGettoni) return ta && ta._snGettoni;
    const doc = ta.ownerDocument;
    const radice = ta.getRootNode ? ta.getRootNode() : doc;
    stile(radice.nodeType === 11 ? radice : doc);
    let schede = []; // allineate ai gettoni del testo
    let fondo = null;
    let sopra = -1;
    let attesa = null;

    const vive = () => schede.filter(Boolean);
    let inArrivo = [];
    // Le schede già passate dal campo: un gettone che esce e torna (Annulla, Taglia e Incolla) ritrova la sua.
    let viste = [];
    let testoPrima = ta.value;
    // Un gettone che la modifica non ha toccato tiene la sua scheda per posizione, non per nome: due titoli accorciati
    // allo stesso nome non si scambiano. Per nome si cercano solo quelli entrati adesso (rilascio, Annulla, Incolla).
    function riallinea() {
      const nuovo = ta.value;
      const vecchio = testoPrima;
      const vecchi = pezzi(vecchio).filter((x) => x.gettone);
      const nuovi = pezzi(nuovo).filter((x) => x.gettone);
      const delta = nuovo.length - vecchio.length;
      const max = Math.min(nuovo.length, vecchio.length);
      let p = 0;
      while (p < max && nuovo[p] === vecchio[p]) p++;
      let s = 0;
      while (s < max - p && nuovo[nuovo.length - 1 - s] === vecchio[vecchio.length - 1 - s]) s++;
      const tenuti = new Set();
      const out = nuovi.map((t) => {
        let j = -1;
        if (t.a <= p) j = vecchi.findIndex((v) => v.da === t.da && v.a === t.a);
        else if (t.da >= nuovo.length - s) j = vecchi.findIndex((v) => v.da === t.da - delta && v.a === t.a - delta);
        if (j < 0 || tenuti.has(j)) return undefined;
        tenuti.add(j);
        return schede[j] || null;
      });
      const resto = inArrivo.concat(schede.filter((x, j) => x && !tenuti.has(j)), viste).map(normalizza).filter(Boolean);
      schede = out.map((x, i) => {
        if (x !== undefined) return x;
        const k = resto.findIndex((r) => etichetta(r) === nuovi[i].etichetta);
        return k >= 0 ? resto.splice(k, 1)[0] : null;
      });
      testoPrima = nuovo;
    }

    let colori = null;
    function ricalca() {
      const ci = schede.some(Boolean);
      // I colori del campo si leggono prima di renderlo trasparente: il fondo disegna il testo al suo posto.
      if (!ta.classList.contains('sn-con-gettoni')) {
        const cs0 = getComputedStyle(ta);
        colori = { testo: cs0.color, fondo: cs0.backgroundColor };
      }
      ta.classList.toggle('sn-con-gettoni', ci);
      if (!ci) { ta.style.caretColor = ''; if (fondo) { fondo.remove(); fondo = null; } return; }
      if (!fondo) {
        fondo = doc.createElement('div');
        fondo.className = 'sn-gettoni-fondo';
        fondo.setAttribute('aria-hidden', 'true');
        ta.parentNode.insertBefore(fondo, ta);
        visto = ta.value;
        requestAnimationFrame(veglia);
      }
      const cs = getComputedStyle(ta);
      const copia = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textIndent',
        'wordSpacing', 'tabSize', 'textAlign', 'direction', 'paddingTop', 'paddingLeft', 'paddingBottom',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRadius'];
      for (const k of copia) fondo.style[k] = cs[k];
      const bl = parseFloat(cs.borderLeftWidth) || 0;
      const br = parseFloat(cs.borderRightWidth) || 0;
      const barra = Math.max(0, ta.offsetWidth - ta.clientWidth - bl - br);
      fondo.style.paddingRight = `${(parseFloat(cs.paddingRight) || 0) + barra}px`;
      fondo.style.whiteSpace = ta.localName === 'input' ? 'pre' : 'pre-wrap';
      fondo.style.color = colori.testo;
      fondo.style.backgroundColor = colori.fondo;
      ta.style.caretColor = colori.testo;
      fondo.style.left = `${ta.offsetLeft}px`;
      fondo.style.top = `${ta.offsetTop}px`;
      fondo.style.width = `${ta.offsetWidth}px`;
      fondo.style.height = `${ta.offsetHeight}px`;
      fondo.textContent = '';
      let i = 0;
      for (const p of pezzi(ta.value)) {
        if (!p.gettone) { fondo.appendChild(doc.createTextNode(p.testo)); continue; }
        const s = schede[i];
        const span = doc.createElement('span');
        if (s) { span.className = 'sn-gettone'; span.dataset.i = String(i); }
        const a = doc.createElement('span');
        a.className = 'sn-gettone-segno';
        a.textContent = APRE;
        const posto = doc.createElement('span');
        posto.className = 'sn-gettone-posto';
        posto.textContent = POSTO;
        if (s) posto.appendChild(icona(doc, s));
        const c = doc.createElement('span');
        c.className = 'sn-gettone-segno';
        c.textContent = CHIUDE;
        span.append(a, posto, doc.createTextNode(p.etichetta), c);
        fondo.appendChild(span);
        i++;
      }
      // Un a capo finale nel textarea occupa una riga; nel div no, senza qualcosa dopo.
      fondo.appendChild(doc.createTextNode('​'));
      fondo.scrollTop = ta.scrollTop;
      fondo.scrollLeft = ta.scrollLeft;
    }

    function gettoneA(pos, verso) {
      for (const p of pezzi(ta.value)) {
        if (!p.gettone) continue;
        if (verso < 0 && pos === p.a) return p;
        if (verso > 0 && pos === p.da) return p;
        if (verso === 0 && pos > p.da && pos < p.a) return p;
      }
      return null;
    }

    function togli(p) {
      ta.focus();
      ta.setSelectionRange(p.da, p.a);
      if (!doc.execCommand('delete')) { ta.setRangeText('', p.da, p.a, 'start'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    }

    // Il cursore non entra in un gettone: si ferma al bordo più vicino, come davanti a un carattere solo.
    function fuoriDaiGettoni() {
      if (!schede.some(Boolean) || ta.selectionStart !== ta.selectionEnd) return;
      const pos = ta.selectionStart;
      const p = gettoneA(pos, 0);
      if (p) { const dove = pos - p.da < p.a - pos ? p.da : p.a; ta.setSelectionRange(dove, dove); }
    }

    ta.addEventListener('keydown', (e) => {
      if ((e.key !== 'Backspace' && e.key !== 'Delete') || ta.selectionStart !== ta.selectionEnd || e.isComposing) return;
      const p = gettoneA(ta.selectionStart, e.key === 'Backspace' ? -1 : 1);
      if (!p) return;
      e.preventDefault();
      togli(p);
    });
    ta.addEventListener('input', () => { riallinea(); ricalca(); });
    ta.addEventListener('scroll', () => { if (fondo) { fondo.scrollTop = ta.scrollTop; fondo.scrollLeft = ta.scrollLeft; } });
    ta.addEventListener('mouseup', fuoriDaiGettoni);
    ta.addEventListener('keyup', (e) => { if (/^Arrow|^Home$|^End$/.test(e.key)) fuoriDaiGettoni(); });
    try { new ResizeObserver(() => { if (fondo) ricalca(); }).observe(ta); } catch (_) {}
    // Un valore scritto dal codice della pagina non manda `input`: finché ci sono gettoni il fondo lo controlla da sé.
    let visto = '';
    const veglia = () => {
      if (!fondo) return;
      if (ta.value !== visto) { riallinea(); ricalca(); }
      visto = ta.value;
      requestAnimationFrame(veglia);
    };

    function gettoneSotto(x, y) {
      if (!fondo) return -1;
      for (const el of fondo.querySelectorAll('.sn-gettone')) {
        for (const r of el.getClientRects()) {
          if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return Number(el.dataset.i);
        }
      }
      return -1;
    }
    function segna(i) {
      if (i === sopra) return;
      sopra = i;
      if (fondo) for (const el of fondo.querySelectorAll('.sn-gettone')) el.classList.toggle('sopra', Number(el.dataset.i) === i);
      clearTimeout(attesa);
      if (i < 0) { try { azioni.nascondi && azioni.nascondi(); } catch (_) {} return; }
      const el = fondo && fondo.querySelector(`.sn-gettone[data-i="${i}"]`);
      attesa = setTimeout(() => {
        if (sopra !== i || !el || !schede[i]) return;
        try { azioni.anteprima && azioni.anteprima(schede[i], el.getBoundingClientRect()); } catch (_) {}
      }, 250);
    }
    ta.addEventListener('mousemove', (e) => segna(gettoneSotto(e.clientX, e.clientY)));
    ta.addEventListener('mouseleave', () => segna(-1));
    ta.addEventListener('click', (e) => {
      const i = gettoneSotto(e.clientX, e.clientY);
      if (i < 0 || !schede[i]) return;
      segna(-1);
      try { azioni.apri && azioni.apri(schede[i]); } catch (_) {}
    });

    const api = {
      // Il gettone entra dove sta il cursore, o in coda se il campo non era a fuoco.
      aggiungi(s) {
        const n = normalizza(s);
        if (!n) return false;
        if (vive().length >= MASSIMO) { try { azioni.troppe && azioni.troppe(MASSIMO); } catch (_) {} return false; }
        const aFuoco = (radice.activeElement || doc.activeElement) === ta;
        const fine = ta.value.length;
        const da = aFuoco ? ta.selectionStart : fine;
        const a = aFuoco ? ta.selectionEnd : fine;
        const prima = ta.value.slice(0, da);
        const t = `${prima && !/\s$/.test(prima) ? ' ' : ''}${gettone(n)} `;
        inArrivo = [n];
        viste = [n, ...viste.filter((s) => s.url !== n.url || s.titolo !== n.titolo)].slice(0, MASSIMO * 4);
        ta.focus();
        ta.setSelectionRange(da, a);
        if (!doc.execCommand('insertText', false, t)) {
          ta.setRangeText(t, da, a, 'end');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
        inArrivo = [];
        riallinea();
        ricalca();
        return true;
      },
      schede: () => vive(),
      // Dopo l'invio (o un valore scritto da codice): il campo rilegge il suo testo.
      rileggi() { riallinea(); ricalca(); },
      svuota() { schede = []; testoPrima = ta.value; ricalca(); },
      ricalca,
    };
    ta._snGettoni = api;
    return api;
  }

  // Il testo di un messaggio nel filo, coi gettoni al posto dei segni. `azioni` come per il campo.
  function nellaBolla(el, t, schede, azioni = {}) {
    const doc = el.ownerDocument;
    stile(el.getRootNode ? (el.getRootNode().nodeType === 11 ? el.getRootNode() : doc) : doc);
    const lista = allinea(t, schede);
    el.textContent = '';
    let i = 0;
    for (const p of pezzi(t)) {
      if (!p.gettone) { el.appendChild(doc.createTextNode(p.testo)); continue; }
      const s = lista[i++];
      if (!s) { el.appendChild(doc.createTextNode(p.etichetta.trim())); continue; }
      const g = doc.createElement('span');
      g.className = 'sn-bolla-gettone';
      g.setAttribute('role', 'link');
      g.tabIndex = 0;
      g.dataset.url = s.url;
      const lab = doc.createElement('span');
      lab.textContent = etichetta(s);
      g.append(icona(doc, s), lab);
      let attesa = null;
      g.addEventListener('mouseenter', () => {
        clearTimeout(attesa);
        attesa = setTimeout(() => { try { azioni.anteprima && azioni.anteprima(s, g.getBoundingClientRect()); } catch (_) {} }, 250);
      });
      g.addEventListener('mouseleave', () => { clearTimeout(attesa); try { azioni.nascondi && azioni.nascondi(); } catch (_) {} });
      const apri = (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(attesa);
        try { azioni.nascondi && azioni.nascondi(); } catch (_) {}
        try { azioni.apri && azioni.apri(s); } catch (_) {}
      };
      g.addEventListener('click', apri);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') apri(e); });
      el.appendChild(g);
    }
  }

  // Le azioni di un gettone, chieste al main (GETTONE_SCHEDA): la carta va messa nella finestra, e la scheda la conosce lui.
  function azioni(extra = {}) {
    const manda = (m) => {
      try {
        const rt = global.chrome && global.chrome.runtime;
        const tipo = (global.SN_MSG && global.SN_MSG.MSG && global.SN_MSG.MSG.GETTONE_SCHEDA) || 'gettone_scheda';
        const p = rt && rt.sendMessage({ type: tipo, ...m });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) {}
    };
    const rect = (r) => (r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null);
    return {
      anteprima: (s, r) => manda({ op: 'anteprima', scheda: s, rect: rect(r) }),
      nascondi: () => manda({ op: 'nascondi' }),
      apri: (s) => manda({ op: 'apri', scheda: s }),
      troppe: (n) => {
        try { global.SN_POPUP && global.SN_POPUP.showToast && global.SN_POPUP.showToast(`In un messaggio entrano al massimo ${n} schede: questa è rimasta fuori.`); } catch (_) {}
      },
      ...extra,
    };
  }

  global.SN_SCHEDE_IN_CHAT = { normalizza, etichetta, gettone, pezzi, allinea, campo, nellaBolla, azioni, MASSIMO, RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SN_SCHEDE_IN_CHAT;
})(typeof globalThis !== 'undefined' ? globalThis : self);
