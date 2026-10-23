// Il pannello di destra delle app di Filo, come dati: cosa può starci per ogni app, cosa c'è di partenza e le mosse
// (posa, togli, configura, migrazione dai moduli della vecchia griglia). Logica pura: la pagina disegna, il main
// conserva. Regole: patterns/a-sinistra-filo-a-destra-l-app.md.

(function (global) {
  'use strict';

  const CONTI = Object.freeze(['words', 'chars', 'sentences', 'paragraphs']);

  // `azione`: l'elemento fa una cosa sola, quindi prende una scorciatoia che fa quello che fa il suo clic.
  // `parole`: come lo chiama chi parla con Filo, oltre al nome.
  const CATALOGHI = Object.freeze({
    editor: Object.freeze({
      nome: 'Editor',
      partenza: Object.freeze(['word-count', 'search-replace', 'comment']),
      elementi: Object.freeze([
        { id: 'word-count', nome: 'Conteggio', azione: true, parole: ['conteggio parole', 'conta parole', 'parole', 'caratteri', 'contatore'] },
        { id: 'search-replace', nome: 'Cerca e sostituisci', azione: true, parole: ['cerca', 'sostituisci', 'trova', 'ricerca'] },
        { id: 'comment', nome: 'Commenta', azione: true, parole: ['commenti', 'commento', 'commentare'] },
        { id: 'text-size', nome: 'Dimensione testo', parole: ['dimensione', 'grandezza del testo', 'dimensione del testo'] },
        { id: 'align', nome: 'Allineamento', parole: ['allinea', 'allineare'] },
        { id: 'font', nome: 'Font', parole: ['carattere', 'tipo di carattere', 'caratteri tipografici'] },
        { id: 'undo', nome: 'Indietro', azione: true, parole: ['annulla'] },
        { id: 'redo', nome: 'Avanti', azione: true, parole: ['ripeti', 'rifai'] },
        { id: 'settings', nome: 'Impostazioni', parole: ['ingranaggio', 'impostazioni degli strumenti'] },
        { id: 'bold', nome: 'Grassetto', azione: true, parole: ['neretto'] },
        { id: 'italic', nome: 'Corsivo', azione: true, parole: [] },
        { id: 'underline', nome: 'Sottolineato', azione: true, parole: ['sottolinea'] },
      ].map((e) => Object.freeze({ ...e, parole: Object.freeze(e.parole) }))),
    }),
  });

  const lista = (v) => (Array.isArray(v) ? v : []);
  const testo = (v) => (typeof v === 'string' ? v : '');

  function catalogo(app) {
    return Object.prototype.hasOwnProperty.call(CATALOGHI, app) ? CATALOGHI[app] : null;
  }

  function elemento(app, id) {
    const c = catalogo(app);
    return (c && c.elementi.find((e) => e.id === id)) || null;
  }

  function noto(app, id) { return !!elemento(app, id); }

  function nome(app, id) {
    const e = elemento(app, id);
    return e ? e.nome : '';
  }

  // Solo i campi che l'elemento sa usare, e solo nella forma che serve a chi li legge.
  function pulisciConfig(app, id, v) {
    const e = elemento(app, id);
    const o = v && typeof v === 'object' ? v : {};
    const out = {};
    if (!e) return out;
    if (e.azione) {
      const sc = testo(o.shortcut).trim();
      if (sc && sc.length <= 80) out.shortcut = sc;
      const T = global.SN_TASTI;
      if (out.shortcut && typeof o.tasto === 'string' && (!T || typeof T.tastoValido !== 'function' || T.tastoValido(o.tasto))) out.tasto = o.tasto;
    }
    if (id === 'word-count' && CONTI.includes(o.count)) out.count = o.count;
    return out;
  }

  // Un salvato illeggibile, o mai scritto, riparte dagli elementi di partenza: nessuna mossa lo rende vuoto per sbaglio.
  function normalizza(app, v) {
    const c = catalogo(app);
    if (!c) return null;
    const o = v && typeof v === 'object' ? v : null;
    const elementi = [];
    for (const id of (o && Array.isArray(o.elementi) ? o.elementi : c.partenza)) {
      if (typeof id === 'string' && noto(app, id) && !elementi.includes(id)) elementi.push(id);
    }
    const config = {};
    const grezza = o && o.config && typeof o.config === 'object' ? o.config : {};
    for (const e of c.elementi) {
      if (!Object.prototype.hasOwnProperty.call(grezza, e.id)) continue;
      const pulita = pulisciConfig(app, e.id, grezza[e.id]);
      if (Object.keys(pulita).length) config[e.id] = pulita;
    }
    return { elementi, config, migrato: !!(o && o.migrato) };
  }

  // Dentro il pannello, davanti a `primaDi` (in fondo se manca): vale per chi entra e per chi si sposta.
  function posa(app, stato, id, primaDi = null) {
    const s = normalizza(app, stato);
    if (!s || !noto(app, id)) return null;
    const resto = s.elementi.filter((x) => x !== id);
    const i = primaDi && primaDi !== id ? resto.indexOf(primaDi) : -1;
    if (i >= 0) resto.splice(i, 0, id);
    else resto.push(id);
    return { ...s, elementi: resto };
  }

  function togli(app, stato, id) {
    const s = normalizza(app, stato);
    if (!s || !s.elementi.includes(id)) return null;
    return { ...s, elementi: s.elementi.filter((x) => x !== id) };
  }

  // La configurazione data sostituisce quella di prima dell'elemento: chi svuota la scorciatoia la toglie.
  function configura(app, stato, id, conf) {
    const s = normalizza(app, stato);
    if (!s || !noto(app, id)) return null;
    const config = { ...s.config };
    const pulita = pulisciConfig(app, id, conf);
    if (Object.keys(pulita).length) config[id] = pulita;
    else delete config[id];
    return { ...s, config };
  }

  // I moduli della vecchia griglia (#1433): le disposizioni si buttano, quello che un elemento sa ancora usare (cosa
  // conta il conteggio, le scorciatoie) passa al pannello. Vince il documento aperto per ultimo, poi i più recenti; una
  // scorciatoia già data a un altro elemento resta al primo.
  function configDaModuli(app, collezione) {
    if (app !== 'editor') return {};
    const files = lista(collezione && collezione.files).filter((f) => f && typeof f === 'object');
    const attivo = collezione && collezione.activeId;
    const ora = (f) => Date.parse((f.meta && f.meta.modified) || '') || 0;
    const ordinati = files.slice().sort((a, b) => (b.id === attivo) - (a.id === attivo) || ora(b) - ora(a));
    const config = {};
    const tasti = new Set();
    for (const f of ordinati) {
      for (const m of lista(f.modules)) {
        const id = m && testo(m.type);
        if (!noto(app, id) || config[id]) continue;
        const pulita = pulisciConfig(app, id, m.data);
        const chiave = pulita.tasto || pulita.shortcut;
        if (chiave && tasti.has(chiave)) { delete pulita.shortcut; delete pulita.tasto; }
        if (chiave && pulita.shortcut) tasti.add(chiave);
        if (Object.keys(pulita).length) config[id] = pulita;
      }
    }
    return config;
  }

  // Una volta sola, sul salvato che non l'ha ancora avuta: dopo, la configurazione è del pannello.
  function migra(app, stato, collezione) {
    const s = normalizza(app, stato);
    if (!s || s.migrato) return null;
    const config = { ...configDaModuli(app, collezione), ...s.config };
    return { ...s, config, migrato: true };
  }

  // Le scorciatoie degli elementi che stanno nel pannello, per chi le confronta con le altre di Filo.
  function scorciatoie(app, stato) {
    const s = normalizza(app, stato);
    if (!s) return [];
    return s.elementi
      .filter((id) => s.config[id] && s.config[id].shortcut)
      .map((id) => ({ id, nome: nome(app, id), shortcut: s.config[id].shortcut, tasto: s.config[id].tasto || '' }));
  }

  const piano = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  // L'elemento che chi parla con Filo ha nominato: l'id, il nome o una delle sue parole. null se non si capisce.
  function risolvi(app, detto) {
    const c = catalogo(app);
    const d = piano(detto);
    if (!c || !d) return null;
    const esatto = c.elementi.find((e) => e.id === String(detto).trim() || piano(e.nome) === d || e.parole.some((p) => piano(p) === d));
    if (esatto) return esatto.id;
    const contiene = c.elementi.filter((e) => d.includes(piano(e.nome)) || e.parole.some((p) => d.includes(piano(p))));
    return contiene.length === 1 ? contiene[0].id : null;
  }

  global.SN_PANNELLI_APP = Object.freeze({
    CATALOGHI, CONTI, catalogo, elemento, noto, nome, normalizza, posa, togli, configura, configDaModuli, migra,
    scorciatoie, risolvi,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
