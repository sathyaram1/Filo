// Le immagini in una risposta di Filo (#2272): il modello scrive [[immagini: id, id]], il main le controlla contro
// le immagini trovate o create nel turno, il renderer disegna solo quelle controllate, mai un indirizzo del testo.
// Prove: tests/unit/immaginiRisposta.test.mjs, tests/chat-immagini.spec.mjs.

(function (global) {
  'use strict';

  const MARCATORE = /\[\[\s*immagin[ei]\s*:([^[\]\n]{0,400})\]\]/gi;
  const CON_SPAZI_PRIMA = new RegExp(`[ \\t]*${MARCATORE.source}`, 'gi');
  // Un marcatore cominciato e non chiuso in fondo al testo: in diretta sta arrivando, a fine turno è stato tagliato.
  const A_META = /\[(?:\[\s*(?:i(?:m(?:m(?:a(?:g(?:i(?:n(?:[ei]\s*(?::[^\]\n]*\]?)?)?)?)?)?)?)?)?)?)?$/i;
  // Segni privati del posto di una galleria (E000-E005 sono di filoMarkdown e delle fonti): il testo non li porta.
  const S6 = '';
  const S7 = '';
  const PRIVATI = /[]/g;
  const POSTO = /(\d+)/g;
  const RIGA_POSTO = /^(\d+)$/;
  const TIPI = new Set(['IMMAGINI_WEB', 'GENERA_IMMAGINE']);
  const MAX_GALLERIE = 50;
  const MAX_VOCI = 24;
  // Solo quello che il main ha già scaricato e copiato: una pagina di Filo che lo mostra non contatta nessuno.
  const SRC_SICURO = /^(?:filo:\/\/icone\/[0-9a-f]{40}\.(?:png|jpg|gif|webp|avif)|data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+)$/;

  const testo = (s) => String(s == null ? '' : s);
  const unaRiga = (s, max) => {
    const t = testo(s).replace(/[\u0000-\u001f\u007f-]/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  };
  const web = (u) => {
    try {
      const x = new URL(testo(u));
      return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
    } catch (_) { return ''; }
  };
  const srcSicuro = (s) => (typeof s === 'string' && s.length < 12 * 1024 * 1024 && SRC_SICURO.test(s) ? s : '');

  // Una voce come si conserva e si disegna: solo i campi noti, coi loro tetti.
  function voce(v) {
    if (!v || typeof v !== 'object') return null;
    const src = srcSicuro(v.src);
    if (!src) return null;
    const pagina = web(v.pagina);
    const l = Math.round(Number(v.larghezza));
    const a = Math.round(Number(v.altezza));
    return {
      src,
      titolo: unaRiga(v.titolo, 200),
      sito: unaRiga(v.sito, 80),
      ...(pagina ? { pagina } : {}),
      ...(v.generata === true ? { generata: true } : {}),
      ...(l > 0 && l < 100000 ? { larghezza: l } : {}),
      ...(a > 0 && a < 100000 ? { altezza: a } : {}),
    };
  }

  // Le immagini del turno, dalle azioni come le vede la chat (`type` e `_output.immagini`), per id.
  function sorgenti(azioni) {
    const out = new Map();
    for (const a of Array.isArray(azioni) ? azioni : []) {
      if (!a || !TIPI.has(String(a.type || '').toUpperCase())) continue;
      const lista = a._output && Array.isArray(a._output.immagini) ? a._output.immagini : [];
      for (const i of lista) {
        const id = testo(i && i.id).trim().toLowerCase();
        const v = voce(i);
        if (id && v && !out.has(id)) out.set(id, { ...v, id });
      }
    }
    return out;
  }

  const togliId = ({ id: _id, ...resto }) => resto;

  // Il testo senza i marcatori e le gallerie che reggono, ognuna col suo posto nel testo restituito. Un id che il turno
  // non ha non diventa niente. Le immagini create e non citate vanno in coda; quelle trovate, solo se la risposta non ne
  // cita nessuna: chi ha chiesto immagini le vede anche se il modello ha dimenticato il marcatore.
  function controlla(text, immaginiDelTurno) {
    const mappa = immaginiDelTurno instanceof Map ? immaginiDelTurno : new Map();
    const src = testo(text).replace(PRIVATI, '').replace(A_META, '');
    const gallerie = [];
    const usate = new Set();
    let out = '';
    let ultimo = 0;
    // Un marcatore su una riga sua lascia due a capo di qua e due di là: ne restano due, un paragrafo.
    const attacca = (pezzo) => {
      const capi = /\n*$/.exec(out)[0].length;
      if (!capi) return pezzo;
      const testa = /^(?:[ \t]*\n)*/.exec(pezzo)[0];
      const tenuti = Math.max(0, Math.min((testa.match(/\n/g) || []).length, 2 - capi));
      return '\n'.repeat(tenuti) + pezzo.slice(testa.length);
    };
    MARCATORE.lastIndex = 0;
    let m;
    while ((m = MARCATORE.exec(src))) {
      out += attacca(src.slice(ultimo, m.index)).replace(/[ \t]+$/, '');
      ultimo = m.index + m[0].length;
      const voci = [];
      for (const pezzo of m[1].split(/[\s,;|]+/)) {
        const id = pezzo.trim().toLowerCase();
        if (!id || !mappa.has(id) || usate.has(id) || voci.length >= MAX_VOCI) continue;
        usate.add(id);
        voci.push(togliId(mappa.get(id)));
      }
      if (voci.length && gallerie.length < MAX_GALLERIE) gallerie.push({ pos: out.length, voci });
    }
    out += attacca(src.slice(ultimo));
    const restano = [...mappa.values()].filter((v) => !usate.has(v.id) && (v.generata || !usate.size));
    for (let i = 0; i < restano.length && gallerie.length < MAX_GALLERIE; i += MAX_VOCI) {
      gallerie.push({ pos: out.length, voci: restano.slice(i, i + MAX_VOCI).map(togliId) });
    }
    const testa = out.length - out.replace(/^\s+/, '').length;
    const finale = out.trim();
    return {
      text: finale,
      immagini: gallerie.map((g) => ({ ...g, pos: Math.max(0, Math.min(finale.length, g.pos - testa)) })),
    };
  }

  // Le fonti e le immagini della stessa risposta controllate insieme: le une e le altre tolgono marcatori, e ognuna
  // deve tenere il suo posto nel testo che resta. Qui il marcatore d'immagine diventa un posto privato prima che le fonti
  // misurino, poi si toglie spostando le loro posizioni.
  function controllaConFonti(text, azioni) {
    const F = global.SN_FONTI_CITATE;
    const prima = controlla(text, sorgenti(azioni));
    let t = prima.text;
    const ordine = prima.immagini.map((g, i) => ({ g, i })).sort((a, b) => a.g.pos - b.g.pos || a.i - b.i);
    let conPosti = '';
    let da = 0;
    for (const { g, i } of ordine) { conPosti += t.slice(da, g.pos) + S6 + i + S7; da = g.pos; }
    conPosti += t.slice(da);
    const citate = F ? F.controlla(conPosti, F.sorgenti(azioni)) : { text: conPosti, fonti: [] };
    // Le posizioni vere: ogni posto privato prima di un punto lo spostava della sua lunghezza.
    const immagini = new Array(prima.immagini.length);
    let pulito = '';
    let tolti = 0;
    const spostamenti = [];
    let u = 0;
    POSTO.lastIndex = 0;
    let m;
    while ((m = POSTO.exec(citate.text))) {
      pulito += citate.text.slice(u, m.index);
      u = m.index + m[0].length;
      immagini[Number(m[1])] = { ...prima.immagini[Number(m[1])], pos: pulito.length };
      spostamenti.push({ da: m.index, n: m[0].length, prima: tolti });
      tolti += m[0].length;
    }
    pulito += citate.text.slice(u);
    const sposta = (p) => {
      let meno = 0;
      for (const s of spostamenti) if (s.da < p) meno = s.prima + s.n;
      return p - meno;
    };
    const finale = pulito.trim();
    const testa = pulito.length - pulito.replace(/^\s+/, '').length;
    const dentro = (p) => Math.max(0, Math.min(finale.length, p - testa));
    return {
      text: finale,
      fonti: citate.fonti.map((f) => ({ ...f, pos: dentro(sposta(f.pos)) })),
      immagini: immagini.filter(Boolean).map((g) => ({ ...g, pos: dentro(g.pos) })),
    };
  }

  // Per chi mostra il testo mentre arriva: niente marcatori a schermo.
  function nascondi(text) {
    return testo(text).replace(CON_SPAZI_PRIMA, '').replace(A_META, '').replace(PRIVATI, '').replace(/[ \t]+(\n|$)/g, '$1');
  }

  // Quello che si conserva: le voci ripulite, posizioni dentro il testo.
  function perIlDisco(immagini, text) {
    const lunghezza = testo(text).length;
    const out = [];
    for (const g of Array.isArray(immagini) ? immagini : []) {
      if (out.length >= MAX_GALLERIE) break;
      const pos = Number(g && g.pos);
      if (!Number.isInteger(pos) || pos < 0 || pos > lunghezza) continue;
      const voci = (Array.isArray(g.voci) ? g.voci : []).map(voce).filter(Boolean).slice(0, MAX_VOCI);
      if (voci.length) out.push({ pos, voci });
    }
    return out;
  }

  // I rimandi alle copie usati dalle gallerie di un elenco di messaggi (chi tiene le copie li chiede).
  function copieDi(messaggi) {
    const out = [];
    for (const msg of Array.isArray(messaggi) ? messaggi : []) {
      for (const g of (msg && Array.isArray(msg.immagini)) ? msg.immagini : []) {
        for (const v of (g && Array.isArray(g.voci)) ? g.voci : []) if (v && typeof v.src === 'string') out.push(v.src);
      }
    }
    return out;
  }

  // ── Disegno ─────────────────────────────────────────────────────────────

  const esc = (s) => testo(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Il testo coi posti delle gallerie, e le fonti spostate di conseguenza (una fonte allo stesso punto resta prima).
  function conPosti(text, immagini, fonti) {
    const t = testo(text).replace(PRIVATI, '');
    const ok = perIlDisco(immagini, t);
    const f = Array.isArray(fonti) ? fonti : [];
    if (!ok.length) return { text: t, fonti: f, gallerie: [] };
    const ordine = ok.map((g, i) => ({ g, i })).sort((a, b) => a.g.pos - b.g.pos || a.i - b.i);
    const posti = [];
    let out = '';
    let da = 0;
    for (const { g, i } of ordine) {
      const posto = `\n\n${S6}${i}${S7}\n\n`;
      out += t.slice(da, g.pos);
      posti.push({ pos: g.pos, n: posto.length });
      out += posto;
      da = g.pos;
    }
    out += t.slice(da);
    const spostate = f.map((x) => {
      const p = Number(x && x.pos);
      if (!Number.isInteger(p)) return x;
      return { ...x, pos: p + posti.filter((s) => s.pos < p).reduce((n, s) => n + s.n, 0) };
    });
    return { text: out, fonti: spostate, gallerie: ok };
  }

  function didascalia(v) {
    return v.generata ? 'Creata con l’AI' : (v.sito || '');
  }

  function fumetto(v) {
    const righe = [];
    if (v.titolo) righe.push(v.titolo);
    if (v.generata) righe.push('Immagine creata con l’AI su tua richiesta');
    else if (v.sito) righe.push(`Da ${v.sito}`);
    return righe.join('\n');
  }

  // Una galleria: un'immagine sola, o un carosello che scorre di lato.
  function html(g) {
    const voci = (g && Array.isArray(g.voci) ? g.voci : []).map(voce).filter(Boolean);
    if (!voci.length) return '';
    const figure = voci.map((v, i) => '<figure class="filo-galleria-voce">'
      + '<img class="filo-galleria-img" src="' + esc(v.src) + '" alt="' + esc(v.titolo || didascalia(v)) + '"'
      + ' loading="lazy" draggable="true" data-galleria-voce="' + i + '"'
      + (v.pagina ? ' data-pagina="' + esc(v.pagina) + '"' : '')
      + (v.generata ? ' data-generata="1"' : '')
      + (v.larghezza && v.altezza ? ' width="' + v.larghezza + '" height="' + v.altezza + '"' : '')
      + ' data-tip="' + esc(fumetto(v)) + '">'
      + '<figcaption>' + esc(didascalia(v)) + '</figcaption></figure>').join('');
    const una = voci.length === 1;
    return '<div class="filo-galleria' + (una ? ' filo-galleria-una' : '') + '" data-voci="' + voci.length + '">'
      + '<div class="filo-galleria-scorre">' + figure + '</div>'
      + (una ? '' : '<button type="button" class="filo-galleria-freccia filo-galleria-prima" aria-label="Immagini prima" data-tip="Prima" hidden>‹</button>'
        + '<button type="button" class="filo-galleria-freccia filo-galleria-dopo" aria-label="Immagini dopo" data-tip="Dopo" hidden>›</button>')
      + '</div>';
  }

  // ── Comportamento nella pagina ──────────────────────────────────────────

  function frecce(gal) {
    const s = gal && gal.querySelector('.filo-galleria-scorre');
    if (!s) return;
    const prima = gal.querySelector('.filo-galleria-prima');
    const dopo = gal.querySelector('.filo-galleria-dopo');
    if (prima) prima.hidden = s.scrollLeft <= 2;
    if (dopo) dopo.hidden = s.scrollLeft + s.clientWidth >= s.scrollWidth - 2;
  }

  // Le frecce compaiono solo dove si può ancora scorrere; la rotella verticale sopra il carosello lo fa scorrere di
  // lato finché c'è strada, poi torna alla pagina.
  function aggancia(root, { apriPagina, ingrandisci } = {}) {
    if (!root || typeof root.addEventListener !== 'function') return () => {};
    const alClic = (e) => {
      const f = e.target && e.target.closest && e.target.closest('.filo-galleria-freccia');
      if (f && root.contains(f)) {
        e.preventDefault();
        e.stopPropagation();
        const s = f.parentElement.querySelector('.filo-galleria-scorre');
        const T = global.SN_THEME_TOKENS;
        const comeScorre = T && typeof T.scrollBehavior === 'function' ? T.scrollBehavior(root.ownerDocument || root) : 'auto';
        if (s) s.scrollBy({ left: (f.classList.contains('filo-galleria-dopo') ? 1 : -1) * Math.max(160, s.clientWidth * 0.8), behavior: comeScorre });
        dopoLoScorrere(f.parentElement);
        return;
      }
      const img = e.target && e.target.closest && e.target.closest('.filo-galleria-img');
      if (img && root.contains(img) && typeof ingrandisci === 'function') {
        e.preventDefault();
        e.stopPropagation();
        ingrandisci(img.currentSrc || img.src, img);
      }
    };
    const allaRotella = (e) => {
      const s = e.target && e.target.closest && e.target.closest('.filo-galleria-scorre');
      if (!s || !root.contains(s) || e.ctrlKey || e.metaKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const versoDestra = e.deltaY > 0;
      const strada = versoDestra ? s.scrollWidth - s.clientWidth - s.scrollLeft : s.scrollLeft;
      if (strada <= 1) return;
      e.preventDefault();
      s.scrollLeft += e.deltaY;
    };
    const alloScorrere = (e) => {
      const s = e.target;
      if (s && s.classList && s.classList.contains('filo-galleria-scorre')) frecce(s.parentElement);
    };
    const allEntrata = (e) => {
      const g = e.target && e.target.closest && e.target.closest('.filo-galleria');
      if (g && root.contains(g)) frecce(g);
    };
    root.addEventListener('click', alClic, true);
    root.addEventListener('wheel', allaRotella, { passive: false });
    root.addEventListener('scroll', alloScorrere, true);
    root.addEventListener('mouseover', allEntrata, true);
    if (typeof apriPagina === 'function') {
      apritori.set(root, apriPagina);
      global.SN_VOCI_PAGINA = Array.isArray(global.SN_VOCI_PAGINA) ? global.SN_VOCI_PAGINA : [];
      if (!global.SN_VOCI_PAGINA.includes(vociMenu)) global.SN_VOCI_PAGINA.push(vociMenu);
    }
    return () => {
      apritori.delete(root);
      root.removeEventListener('click', alClic, true);
      root.removeEventListener('wheel', allaRotella);
      root.removeEventListener('scroll', alloScorrere, true);
      root.removeEventListener('mouseover', allEntrata, true);
    };
  }

  const apritori = new Map();
  // Il tasto destro su un'immagine trovata sul web: la pagina da cui viene (le voci dell'immagine le mette il menu di Filo).
  function vociMenu(target) {
    const el = target && target.nodeType === 1 ? target : target && target.parentElement;
    const img = el && el.closest ? el.closest('.filo-galleria-img') : null;
    const pagina = img && img.dataset.pagina;
    if (!pagina) return [];
    let apri = null;
    for (const [root, fn] of apritori) if (root.contains(img)) apri = fn;
    if (!apri) return [];
    const I = global.SN_ICONS || {};
    return [{ type: 'item', icon: typeof I.openTab === 'function' ? I.openTab(16) : '', label: 'Apri la pagina dell’immagine', onClick: () => apri(pagina, img) }];
  }

  global.SN_IMMAGINI_RISPOSTA = Object.freeze({
    POSTO, RIGA_POSTO, PRIVATI, sorgenti, controlla, controllaConFonti, nascondi, perIlDisco, copieDi, conPosti, html,
    srcSicuro, voce, aggancia, vociMenu, frecce,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
