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

  const testo = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

  function estensione(percorso) {
    const base = String(percorso || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
    const i = base.lastIndexOf('.');
    return i > 0 ? base.slice(i + 1).toLowerCase() : '';
  }
  function nomeDelProgramma(percorso) {
    const base = String(percorso || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
    const e = estensione(base);
    return e && ESTENSIONI_APP.includes(e) ? base.slice(0, -(e.length + 1)) : base;
  }
  const assoluto = (p) => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p);

  // «youtube.com», «https://…», «localhost:3000»: un indirizzo che si apre in una scheda, o ''.
  function normalizzaIndirizzo(raw) {
    let s = testo(raw);
    if (!s || /\s/.test(s)) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s) || /^localhost:\d/i.test(s)) s = `https://${s}`;
    let u;
    try { u = new URL(s); } catch (_) { return ''; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const host = u.hostname;
    if (!host || !(host.includes('.') || host === 'localhost' || /^\[.*\]$/.test(host))) return '';
    return u.href;
  }
  const icona = (v) => (typeof v === 'string' && /^data:image\/[a-z0-9.+-]+[;,]/i.test(v) && v.length <= MAX_ICONA ? v : '');
  const nuovoId = () => `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  function voceValida(v) {
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !v.id) return null;
    const nome = testo(v.nome).slice(0, MAX_NOME);
    if (v.tipo === 'app') {
      const percorso = String(v.percorso || '');
      if (!percorso || !assoluto(percorso)) return null;
      return { id: v.id, tipo: 'app', percorso, nome: nome || nomeDelProgramma(percorso), icona: icona(v.icona) };
    }
    const url = normalizzaIndirizzo(v.url);
    if (!url) return null;
    return { id: v.id, tipo: 'sito', url, nome: nome || new URL(url).hostname.replace(/^www\./, ''), icona: icona(v.icona) };
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
        if (!url) return errore(voci, testo(m.url) ? `«${testo(m.url).slice(0, 80)}» non è l'indirizzo di un sito` : 'manca l\'indirizzo del sito');
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

  // Quello che la chat legge della barra: nome e indirizzo, mai le icone.
  function descrivi(voci) {
    return normalizza(voci).map((v) => (v.tipo === 'app' ? { nome: v.nome, programma: v.percorso } : { nome: v.nome, indirizzo: v.url }));
  }

  global.SN_BARRA_SITI = { MAX_VOCI, MAX_NOME, ESTENSIONI_APP, estensione, nomeDelProgramma, normalizzaIndirizzo, normalizza, trova, applica, operazione, descrivi };
})(typeof globalThis !== 'undefined' ? globalThis : self);
