// La barra dei siti della nuova scheda (#1803): forma delle voci e mosse, logica pura. La scrive solo
// src/main/services/barraSiti.js, che passa di qui per i gesti della home e per la chat; prove in tests/unit/barraSiti.test.mjs.

(function (global) {
  'use strict';

  // Tetti larghi: una barra di 200 icone non sta più in una riga, ma chi la riempie deve saperlo, non perdere voci.
  const MAX_VOCI = 200;
  const MAX_NOME = 300;
  const MAX_ICONA = 200000;
  // I tipi che un clic avvia. Senza estensione vale solo un eseguibile di Linux o Mac, che controlla il main.
  const ESTENSIONI_APP = ['lnk', 'exe', 'url', 'appref-ms', 'app', 'desktop', 'appimage'];

  // Le regole che Filo ha già: indirizzi della navigazione (urlNav.js) ed estensioni dei file che eseguono (eseguibili.js).
  const modulo = (nome, file) => {
    if (!global[nome] && typeof require === 'function') { try { require(file); } catch (_) {} }
    return global[nome] || null;
  };
  const nav = () => modulo('SN_URL_NAV', './urlNav.js');
  const ese = () => modulo('SN_ESEGUIBILI', './eseguibili.js');

  const testo = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  // Un nome si mostra senza i segni che ne capovolgono la lettura (#588).
  const nomeLeggibile = (v) => testo(ese() ? ese().nomeVisibile(v) : v);

  const baseDel = (percorso) => String(percorso || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  function estensione(percorso) {
    return ese().estensione(baseDel(percorso));
  }
  function nomeDelProgramma(percorso) {
    const base = ese().nomeVero(baseDel(percorso));
    const e = ese().estensione(base);
    return e && ESTENSIONI_APP.includes(e) ? base.slice(0, -(e.length + 1)) : base;
  }
  const assoluto = (p) => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p);

  // Quello che la navigazione aprirebbe scrivendolo: un sito o una pagina di Filo, o '' (una ricerca, un file, uno
  // schema che non è una pagina). La rete di casa e i server locali vanno in http come nella navigazione.
  function indirizzoNavigato(raw) {
    const s = testo(raw);
    const N = nav();
    if (!s || /\s/.test(s) || !N) return { url: '', tipo: '' };
    const n = N.normalizeUrl(s);
    if (N.ricercaDi(n) === s) return { url: '', tipo: 'ricerca' };
    let u;
    try { u = new URL(n); } catch (_) { return { url: '', tipo: '' }; }
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) return { url: u.href, tipo: 'sito' };
    if (u.protocol === 'filo:' && u.hostname) return { url: N.canonicalizeFiloUrl(u.href), tipo: 'filo' };
    return { url: '', tipo: u.protocol === 'file:' ? 'file' : '' };
  }
  const normalizzaIndirizzo = (raw) => indirizzoNavigato(raw).url;
  function perchéNonEntra(raw) {
    const t = testo(raw);
    if (!t) return 'manca l\'indirizzo del sito';
    if (indirizzoNavigato(t).tipo === 'file') return 'un file aperto in una scheda non va nella barra: ci vanno siti, pagine di Filo e programmi';
    return `«${t.slice(0, 80)}» non è l'indirizzo di un sito`;
  }
  // Il nome di partenza: il sito, o per una pagina di Filo la sua cartella («history»).
  const nomeDelSito = (url) => new URL(url).hostname.replace(/^www\./, '');
  const icona = (v) => (typeof v === 'string' && /^data:image\/[a-z0-9.+-]+[;,]/i.test(v) && v.length <= MAX_ICONA ? v : '');
  const nuovoId = () => `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  function voceValida(v) {
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !v.id) return null;
    const nome = nomeLeggibile(v.nome).slice(0, MAX_NOME);
    if (v.tipo === 'app') {
      const percorso = String(v.percorso || '');
      if (!percorso || !assoluto(percorso)) return null;
      return { id: v.id, tipo: 'app', percorso, nome: nome || nomeDelProgramma(percorso), icona: icona(v.icona) };
    }
    const url = normalizzaIndirizzo(v.url);
    if (!url) return null;
    return { id: v.id, tipo: 'sito', url, nome: nome || nomeDelSito(url), icona: icona(v.icona) };
  }

  function normalizza(raw) {
    const voci = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.voci) ? raw.voci : []);
    const visti = new Set();
    const out = [];
    for (const r of voci) {
      const v = voceValida(r);
      if (!v || visti.has(v.id)) continue;
      visti.add(v.id);
      out.push(v);
    }
    return out;
  }

  const stessoSito = (a, b) => a.replace(/\/$/, '') === b.replace(/\/$/, '');
  const hostDi = (url) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } };

  // La voce detta da chi chiede: l'id, poi l'indirizzo o il percorso, poi il nome esatto, il sito, un pezzo del nome.
  function trova(voci, chi) {
    const s = testo(chi);
    if (!s) return null;
    const l = s.toLowerCase();
    const url = normalizzaIndirizzo(s);
    return voci.find((v) => v.id === s)
      || voci.find((v) => (v.tipo === 'app' ? v.percorso === s : (url && stessoSito(v.url, url))))
      || voci.find((v) => v.nome.toLowerCase() === l)
      || voci.find((v) => v.tipo === 'sito' && (hostDi(v.url) === l.replace(/^www\./, '') || hostDi(v.url).split('.')[0] === l))
      || voci.find((v) => v.nome.toLowerCase().includes(l))
      || null;
  }

  const esito = (voci, cambiato, extra = {}) => ({ voci, cambiato, ...extra });
  const errore = (voci, e) => ({ voci, cambiato: false, errore: e });

  // mossa: { tipo: aggiungi | togli | sposta | rinomina | icona, … }. Torna { voci, cambiato, voce?, errore? }.
  function applica(prima, mossa) {
    const voci = normalizza(prima);
    const m = mossa && typeof mossa === 'object' ? mossa : {};
    const tipo = String(m.tipo || '');
    if (tipo === 'aggiungi') {
      const percorso = String(m.percorso || '').trim();
      let nuova;
      if (percorso) {
        if (!assoluto(percorso)) return errore(voci, 'serve il percorso intero del programma');
        const gia = voci.find((v) => v.tipo === 'app' && v.percorso === percorso);
        if (gia) return esito(voci, false, { voce: gia, gia: true });
        nuova = voceValida({ id: nuovoId(), tipo: 'app', percorso, nome: m.nome, icona: m.icona });
      } else {
        const url = normalizzaIndirizzo(m.url);
        if (!url) return errore(voci, perchéNonEntra(m.url));
        const gia = voci.find((v) => v.tipo === 'sito' && stessoSito(v.url, url));
        if (gia) return esito(voci, false, { voce: gia, gia: true });
        nuova = voceValida({ id: nuovoId(), tipo: 'sito', url, nome: m.nome, icona: m.icona });
      }
      if (!nuova) return errore(voci, 'voce non valida');
      if (voci.length >= MAX_VOCI) return errore(voci, `la barra ha già ${voci.length} voci, il massimo è ${MAX_VOCI}: togline una prima`);
      const rif = m.prima ? (voci.find((v) => v.id === m.prima) || trova(voci, m.prima)) : null;
      const dove = rif ? voci.indexOf(rif) : -1;
      const dopo = voci.slice();
      dopo.splice(dove >= 0 ? dove : dopo.length, 0, nuova);
      return esito(dopo, true, { voce: nuova });
    }
    const v = m.id ? voci.find((x) => x.id === m.id) : trova(voci, m.voce);
    if (!v) return errore(voci, voci.length ? 'nella barra non c\'è questa voce' : 'la barra dei siti è vuota');
    if (tipo === 'togli') return esito(voci.filter((x) => x !== v), true, { voce: v });
    if (tipo === 'rinomina') {
      const nome = testo(m.nome);
      if (!nome) return errore(voci, 'manca il nome nuovo');
      if (nome.length > MAX_NOME) return errore(voci, `il nome ha ${nome.length} caratteri, il massimo è ${MAX_NOME}`);
      if (nome === v.nome) return esito(voci, false, { voce: v });
      const nuova = { ...v, nome };
      return esito(voci.map((x) => (x === v ? nuova : x)), true, { voce: nuova });
    }
    if (tipo === 'icona') {
      const i = icona(m.icona);
      if (!i || i === v.icona) return esito(voci, false, { voce: v });
      const nuova = { ...v, icona: i };
      return esito(voci.map((x) => (x === v ? nuova : x)), true, { voce: nuova });
    }
    if (tipo === 'sposta') {
      const resto = voci.filter((x) => x !== v);
      const da = voci.indexOf(v);
      let dove;
      const verso = String(m.verso || '').toLowerCase().replace('giù', 'giu');
      if (m.prima !== undefined || m.primaDi !== undefined) {
        const chi = m.prima !== undefined ? m.prima : m.primaDi;
        if (chi === null || chi === '') dove = resto.length;
        else {
          const rif = resto.find((x) => x.id === chi) || trova(resto, chi);
          if (!rif) return errore(voci, 'non trovo la voce davanti a cui metterla');
          dove = resto.indexOf(rif);
        }
      } else if (verso === 'cima' || verso === 'inizio' || verso === 'prima') dove = 0;
      else if (verso === 'fondo' || verso === 'fine' || verso === 'ultima') dove = resto.length;
      else if (verso === 'su' || verso === 'sinistra') dove = Math.max(0, da - 1);
      else if (verso === 'giu' || verso === 'destra') dove = Math.min(resto.length, da + 1);
      else return errore(voci, 'dove va? verso cima, fondo, sinistra, destra o prima di un\'altra voce');
      const dopo = resto.slice();
      dopo.splice(dove, 0, v);
      const cambiato = dopo.some((x, i) => x !== voci[i]);
      return esito(cambiato ? dopo : voci, cambiato, { voce: v });
    }
    return errore(voci, 'mossa sconosciuta');
  }

  // L'operazione che la chat chiede, coi sinonimi che il modello usa; '' se non è una della barra.
  const OPERAZIONI = { aggiungi: 'aggiungi', metti: 'aggiungi', togli: 'togli', rimuovi: 'togli', rinomina: 'rinomina', sposta: 'sposta', elenca: 'elenca', leggi: 'elenca', ripiega: 'ripiega', riapri: 'riapri' };
  function operazione(a) {
    const op = String((a && typeof a === 'object' ? (a.operazione ?? a.op) : a) || '').trim().toLowerCase();
    return OPERAZIONI[op] || '';
  }

  // La mossa che chiede la chat (azione BARRA_SITI): `elemento` è la voce, o per aggiungi il sito o il percorso del
  // programma; un percorso intero è un programma. `indirizzo`, `percorso` e `voce` valgono come sinonimi.
  function mossaDaChat(a) {
    const x = a && typeof a === 'object' ? a : {};
    const dato = (k) => (x[k] == null ? '' : String(x[k]).trim());
    const tipo = operazione(x);
    const cosa = dato('elemento') || dato('voce');
    const prima = dato('prima_di') ? { prima: dato('prima_di') } : {};
    if (tipo === 'aggiungi') {
      const percorso = dato('percorso') || (assoluto(cosa) ? cosa : '');
      return { tipo, ...(percorso ? { percorso } : { url: dato('indirizzo') || dato('url') || cosa }), nome: dato('nome'), ...prima };
    }
    return { tipo, voce: cosa || dato('indirizzo') || (tipo === 'rinomina' ? '' : dato('nome')), nome: dato('nome'), verso: dato('verso'), ...prima };
  }

  // Quello che la chat legge della barra: nome e indirizzo, mai le icone.
  function descrivi(voci) {
    return normalizza(voci).map((v) => (v.tipo === 'app' ? { nome: v.nome, programma: v.percorso } : { nome: v.nome, indirizzo: v.url }));
  }

  global.SN_BARRA_SITI = { MAX_VOCI, MAX_NOME, ESTENSIONI_APP, estensione, nomeDelProgramma, normalizzaIndirizzo, normalizza, trova, applica, operazione, mossaDaChat, descrivi };
})(typeof globalThis !== 'undefined' ? globalThis : self);
