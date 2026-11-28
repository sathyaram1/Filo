// Le fonti che una risposta di Filo cita (#2383): il modello scrive il marcatore, il main lo controlla contro le pagine
// e le ricerche del turno, il renderer disegna l'etichetta solo dalle fonti controllate, mai dal testo.
// Prove: tests/unit/fontiCitate.test.mjs, tests/fonti-citate.spec.mjs.

(function (global) {
  'use strict';

  // [[fonte: indirizzo | frase della pagina | traduzione]]. Dentro, una ] da sola può stare (una nota [1] citata), e
  // anche un a capo della frase copiata; il tetto tiene lineare un [[fonte: mai chiuso.
  const MARCATORE = /\[\[\s*fonte\s*:((?:[^[\]]|\](?!\])|\[(?!\[)){0,6000}?)\]\]/gi;
  const CON_SPAZI_PRIMA = new RegExp(`[ \\t]*${MARCATORE.source}`, 'gi');
  // Un marcatore cominciato e non chiuso in fondo al testo: in diretta sta arrivando, a fine turno è stato tagliato.
  const A_META = /\[(?:\[\s*(?:f(?:o(?:n(?:t(?:e\s*(?::(?:[^\]\n]|\](?!\]))*\]?)?)?)?)?)?)?)?$/i;
  // Segni privati: E000/E001 sono di filoMarkdown, E002/E003 il posto di un'etichetta. Il testo del modello non li porta.
  const PRIVATI = /[-]/g;
  const POSTO = /(\d+)/g;
  const ESITI = new Set(['verificata', 'non_trovata']);
  const TIPI = new Set(['pagina', 'ricerca']);
  const MAX_FONTI = 200;
  const MAX_CITAZIONE = 2000;

  const testo = (s) => String(s == null ? '' : s);
  const unaRiga = (s, max) => {
    const t = testo(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  };

  // Quello che due scritture della stessa frase non hanno in comune: maiuscole, spazi e a capo, apostrofi e
  // virgolette tipografiche, lineette, puntini, caratteri invisibili. `mappa[i]` è il posto nell'originale.
  // Gli accenti si confrontano senza segni: «é» composto o scritto come e + accento è la stessa lettera.
  function piega(c) {
    return c.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/[­​-‍⁠﻿]/g, '')
      .replace(/[‘’‚‛′´`]/g, "'")
      .replace(/[“”„‟«»″]/g, '"')
      .replace(/[‐-―−]/g, '-')
      .replace(/…/g, '...');
  }
  function normalizzaConMappa(s) {
    const src = testo(s);
    let n = '';
    const mappa = [];
    let spazio = false;
    for (let i = 0; i < src.length; i++) {
      const cp = src.codePointAt(i);
      const c = cp > 0xffff ? src.slice(i, i + 2) : src[i];
      // Una pagina lunga è quasi tutta ASCII: la piega costa solo sul resto.
      const t = cp < 128 ? (cp === 96 ? "'" : c.toLowerCase()) : piega(c);
      const bianco = cp < 128 ? (cp === 32 || (cp >= 9 && cp <= 13)) : /^\s+$/.test(t);
      if (bianco) {
        if (n && !spazio) { n += ' '; mappa.push(i); }
        spazio = true;
      } else if (t) {
        n += t;
        for (let j = 0; j < t.length; j++) mappa.push(i);
        spazio = false;
      }
      if (c.length === 2) i++;
    }
    if (n.endsWith(' ')) { n = n.slice(0, -1); mappa.pop(); }
    return { n, mappa };
  }
  const normalizza = (s) => normalizzaConMappa(s).n;

  // I pezzi della citazione: il modello ne salta una parte con «…» o «[…]», e le virgolette intorno non sono della pagina.
  function pezzi(citazione) {
    return normalizza(citazione)
      .split(/\s*\[?\.\.\.\]?\s*/)
      .map((p) => p.replace(/^["\s]+|["\s]+$/g, ''))
      .filter(Boolean);
  }

  // La frase com'è scritta nella pagina, se c'è: tutti i pezzi, nell'ordine. Altrimenti ''.
  // `norm`: la pagina già normalizzata, per non rifarlo a ogni marcatore.
  function trova(citazione, testoPagina, norm = null) {
    const p = pezzi(citazione);
    if (!p.length) return '';
    const { n, mappa } = norm || normalizzaConMappa(testoPagina);
    let da = 0;
    let inizio = -1;
    let fine = -1;
    for (const pezzo of p) {
      const i = n.indexOf(pezzo, da);
      if (i < 0) return '';
      if (inizio < 0) inizio = i;
      fine = i + pezzo.length;
      da = fine;
    }
    const src = testo(testoPagina);
    const ultimo = mappa[fine - 1];
    return src.slice(mappa[inizio], ultimo + (src.codePointAt(ultimo) > 0xffff ? 2 : 1));
  }

  // Lo stesso indirizzo scritto in due modi (www, barra in fondo, frammento, lettere codificate) ha la stessa chiave.
  function chiave(url) {
    try {
      const u = new URL(testo(url).trim());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      let p = u.pathname;
      try { p = decodeURIComponent(p); } catch (_) {}
      return `${u.hostname.toLowerCase().replace(/^www\./, '')}${p.replace(/\/+$/, '')}${u.search}`;
    } catch (_) { return ''; }
  }

  function indirizzoWeb(url) {
    try {
      const u = new URL(testo(url).trim());
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
    } catch (_) { return ''; }
  }

  // Il nome breve se Filo conosce il sito (src/shared/sitiComuni.js), se no il dominio senza www.
  function nomeSito(url) {
    let host = '';
    try { host = new URL(testo(url)).hostname.toLowerCase(); } catch (_) { return ''; }
    const S = global.SN_SITI_COMUNI;
    const noto = S && Array.isArray(S.SITI) ? S.SITI.find((s) => s.host.test(host)) : null;
    return noto ? noto.nome.toLowerCase() : host.replace(/^www\./, '');
  }

  // Le pagine lette e i risultati di ricerca del turno, dalle azioni come le vede la chat (`type` e `_output`).
  // Il testo intero di una pagina lunga sta su `testoIntero` (src/main/services/pageRead.js), non nella porzione.
  function sorgenti(azioni, { ora = Date.now() } = {}) {
    const out = [];
    const quando = new Date(ora).toISOString();
    for (const a of Array.isArray(azioni) ? azioni : []) {
      const o = a && a._output;
      if (!o || typeof o !== 'object') continue;
      const tipo = String(a.type || '').toUpperCase();
      if (tipo === 'LEGGI_PAGINA' && o.ok && 'pageRead' in o) {
        const url = indirizzoWeb(o.url);
        if (!url) continue;
        const chiavi = new Set([chiave(url), chiave(o.pageRead), chiave(a.url)].filter(Boolean));
        const t = typeof o.testoIntero === 'string' ? o.testoIntero : testo(o.testo);
        out.push({ tipo: 'pagina', url, chiavi, titolo: testo(o.titolo), testo: `${testo(o.titolo)}\n${t}`, lettaIl: o.lettaIl || quando });
      } else if (tipo === 'CERCA_WEB' && Array.isArray(o.results)) {
        for (const r of o.results) {
          const url = indirizzoWeb(r && r.url);
          if (!url) continue;
          out.push({ tipo: 'ricerca', url, chiavi: new Set([chiave(url)]), titolo: testo(r.title), testo: `${testo(r.title)}\n${testo(r.snippet)}`, lettaIl: quando });
        }
      }
    }
    return out;
  }

  const togliVirgolette = (s) => testo(s).trim().replace(/^["«“”'‘’»\s]+|["»”“'’‘«\s]+$/g, '').trim();

  // Il testo con i marcatori tolti e le fonti che reggono: un indirizzo che il turno non ha letto non diventa
  // un'etichetta (urlExfil.js: un indirizzo scritto dal modello può portare fuori dati), la frase resta senza.
  // `pos`: dove va l'etichetta nel testo restituito, già senza spazi in testa e in coda.
  function controlla(text, fontiDelTurno) {
    const lista = Array.isArray(fontiDelTurno) ? fontiDelTurno : [];
    const src = testo(text).replace(PRIVATI, '').replace(A_META, '');
    const fonti = [];
    const normali = new Map();
    const normaleDi = (s) => {
      if (!normali.has(s)) normali.set(s, normalizzaConMappa(s.testo));
      return normali.get(s);
    };
    let out = '';
    let ultimo = 0;
    MARCATORE.lastIndex = 0;
    let m;
    while ((m = MARCATORE.exec(src))) {
      out += src.slice(ultimo, m.index).replace(/[ \t]+$/, '');
      ultimo = m.index + m[0].length;
      const campi = m[1].split('|');
      const k = chiave(campi[0]);
      const viste = k ? lista.filter((s) => s.chiavi && s.chiavi.has(k)) : [];
      if (!viste.length) continue;
      const pagina = viste.find((s) => s.tipo === 'pagina') || viste[0];
      const citazione = togliVirgolette(campi[1]);
      const traduzione = togliVirgolette(campi.slice(2).join('|'));
      let frase = '';
      for (const s of [pagina, ...viste.filter((x) => x !== pagina)]) { frase = trova(citazione, s.testo, normaleDi(s)); if (frase) break; }
      const pos = /\n$/.test(out) ? out.replace(/\s+$/, '').length : out.length;
      fonti.push({
        pos, url: pagina.url, tipo: pagina.tipo, sito: nomeSito(pagina.url),
        titolo: unaRiga(pagina.titolo, 300),
        citazione: unaRiga(frase || citazione, MAX_CITAZIONE),
        ...(traduzione ? { traduzione: unaRiga(traduzione, MAX_CITAZIONE) } : {}),
        lettaIl: pagina.lettaIl, esito: frase ? 'verificata' : 'non_trovata',
      });
    }
    out += src.slice(ultimo);
    const testa = out.length - out.replace(/^\s+/, '').length;
    const finale = out.trim();
    return {
      text: finale,
      fonti: fonti.map((f) => ({ ...f, pos: Math.max(0, Math.min(finale.length, f.pos - testa)) })),
    };
  }

  // Per chi mostra il testo mentre arriva (la bolla in diretta, le note di lavoro): niente marcatori a schermo.
  function nascondi(text) {
    return testo(text).replace(CON_SPAZI_PRIMA, '').replace(A_META, '').replace(/[ \t]+(\n|$)/g, '$1');
  }

  // Quello che si conserva di una fonte: solo i campi del controllo, coi loro tetti, e mai il testo della pagina.
  function perIlDisco(fonti, text) {
    const lunghezza = testo(text).length;
    const out = [];
    for (const f of Array.isArray(fonti) ? fonti : []) {
      if (out.length >= MAX_FONTI) break;
      const url = f && indirizzoWeb(f.url);
      if (!url || url.length > 4096 || !ESITI.has(f.esito)) continue;
      const pos = Number(f.pos);
      if (!Number.isInteger(pos) || pos < 0 || pos > lunghezza) continue;
      const letta = Date.parse(f.lettaIl);
      out.push({
        pos, url, tipo: TIPI.has(f.tipo) ? f.tipo : 'pagina',
        sito: unaRiga(f.sito, 80) || nomeSito(url),
        titolo: unaRiga(f.titolo, 300),
        citazione: unaRiga(f.citazione, MAX_CITAZIONE),
        ...(f.traduzione ? { traduzione: unaRiga(f.traduzione, MAX_CITAZIONE) } : {}),
        lettaIl: Number.isFinite(letta) ? new Date(letta).toISOString() : '',
        esito: f.esito,
      });
    }
    return out;
  }

  // ── Disegno ─────────────────────────────────────────────────────────────

  const esc = (s) => testo(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Il testo con i posti delle etichette, per il renderer: i segni privati del testo se ne vanno prima.
  function conPosti(text, fonti) {
    const t = testo(text);
    const ok = perIlDisco(fonti, t);
    if (!ok.length) return { text: t.replace(PRIVATI, ''), fonti: [] };
    const ordine = ok.map((f, i) => ({ f, i })).sort((a, b) => a.f.pos - b.f.pos || a.i - b.i);
    let out = '';
    let da = 0;
    for (const { f, i } of ordine) {
      out += t.slice(da, f.pos).replace(PRIVATI, '') + `${i}`;
      da = f.pos;
    }
    out += t.slice(da).replace(PRIVATI, '');
    return { text: out, fonti: ok };
  }

  function quando(iso, tipo) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    const stessoAnno = d.getFullYear() === new Date().getFullYear();
    const giorno = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', ...(stessoAnno ? {} : { year: 'numeric' }) });
    const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    return tipo === 'ricerca' ? `Dai risultati di una ricerca, il ${giorno} alle ${ora}` : `Letta da Filo il ${giorno} alle ${ora}`;
  }

  // Il fumetto (SN_SUGGERIMENTO, data-tip): la frase, la traduzione segnata come tale, la pagina e quando.
  function fumetto(f) {
    const righe = [];
    if (f.esito !== 'verificata') righe.push(f.tipo === 'ricerca' ? 'Filo non ha trovato questa frase nel risultato della ricerca' : 'Filo non ha trovato questa frase nella pagina');
    if (f.citazione) righe.push(`«${f.citazione}»`);
    if (f.traduzione) righe.push(`Traduzione, non controllata: «${f.traduzione}»`);
    const dove = [f.titolo || f.sito, quando(f.lettaIl, f.tipo)].filter(Boolean);
    return [righe.join('\n'), dove.join('\n')].filter(Boolean).join('\n\n');
  }

  function html(f) {
    const dubbia = f.esito !== 'verificata';
    return ' <span class="filo-fonte' + (dubbia ? ' filo-fonte-dubbia' : '') + '" role="link" tabindex="0"'
      + ' data-fonte-url="' + esc(f.url) + '" data-fonte-citazione="' + esc(f.citazione) + '"'
      + ' data-fonte-esito="' + esc(f.esito) + '" aria-label="' + esc(`Fonte: ${f.sito}${dubbia ? ', frase non trovata' : ''}`) + '"'
      + ' data-tip="' + esc(fumetto(f)) + '">' + esc(f.sito) + (dubbia ? '?' : '') + '</span>';
  }

  // La pagina scesa fino alla frase ed evidenziata (frammento di testo di Chromium). Una frase lunga o su più righe
  // si indica col principio e la fine; una frase non trovata apre la pagina in cima.
  function indirizzoConFrase(url, citazione, esito = 'verificata') {
    const web = indirizzoWeb(url);
    if (!web) return '';
    const frase = unaRiga(citazione, 100000).replace(/…$/, '');
    if (esito !== 'verificata' || !frase) return web;
    const cod = (s) => encodeURIComponent(s).replace(/-/g, '%2D');
    const parole = frase.split(' ');
    const direttiva = parole.length > 12
      ? `${cod(parole.slice(0, 5).join(' '))},${cod(parole.slice(-5).join(' '))}`
      : cod(frase);
    const u = new URL(web);
    const hash = u.hash.replace(/^#/, '').split(':~:')[0];
    u.hash = `${hash}:~:text=${direttiva}`;
    return u.href;
  }

  const etichettaDi = (el) => (el && el.closest ? el.closest('.filo-fonte') : null);
  const apritori = new Map();
  function apritoreDi(el) {
    for (const [root, apri] of apritori) if (root.contains(el)) return apri;
    return null;
  }
  function apriEtichetta(el) {
    const apri = apritoreDi(el);
    if (!apri) return;
    apri(indirizzoConFrase(el.dataset.fonteUrl, el.dataset.fonteCitazione, el.dataset.fonteEsito), el);
  }

  async function copia(t) {
    try { await navigator.clipboard.writeText(t); return; } catch (_) {}
    try {
      const tipo = global.SN_MSG && global.SN_MSG.MSG && global.SN_MSG.MSG.COPY_TEXT_TO_CLIPBOARD;
      if (tipo && global.chrome && global.chrome.runtime) await global.chrome.runtime.sendMessage({ type: tipo, text: t });
    } catch (_) {}
  }

  // Il tasto destro sull'etichetta, dentro il menu di Filo (patterns/menu-contestuale-proprio-nelle-pagine-filo-preventdefault.md).
  function vociMenu(target) {
    const el = etichettaDi(target && target.nodeType === 1 ? target : target && target.parentElement);
    if (!el || !apritoreDi(el)) return [];
    const I = global.SN_ICONS || {};
    const icona = (n) => (typeof I[n] === 'function' ? I[n](16) : '');
    // `elemento`: l'etichetta, più stretta del messaggio che la contiene: il clic dell'icona va a lei (#2555).
    return [
      { type: 'item', icon: icona('copy'), label: 'Copia la citazione', elemento: el, onClick: () => { copia(el.dataset.fonteCitazione || ''); } },
      { type: 'item', icon: icona('link'), label: 'Copia l’indirizzo', elemento: el, onClick: () => { copia(el.dataset.fonteUrl || ''); } },
      { type: 'item', icon: icona('openTab'), label: 'Apri la pagina sulla frase', elemento: el, onClick: () => apriEtichetta(el) },
    ];
  }

  // Clic, Invio e Spazio aprono la pagina sulla frase; `apri(indirizzo, elemento)` è la porta dei collegamenti della
  // superficie, la stessa dei link in chat. Ritorna la funzione che stacca.
  function aggancia(root, apri) {
    if (!root || typeof apri !== 'function' || typeof root.addEventListener !== 'function') return () => {};
    apritori.set(root, apri);
    const alClic = (e) => {
      const el = etichettaDi(e.target);
      if (!el || !root.contains(el)) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      apriEtichetta(el);
    };
    // In cattura: il clic sull'etichetta è suo, non della bolla che la contiene (che riapre o cita la conversazione).
    root.addEventListener('click', alClic, true);
    root.addEventListener('keydown', alClic, true);
    global.SN_VOCI_PAGINA = Array.isArray(global.SN_VOCI_PAGINA) ? global.SN_VOCI_PAGINA : [];
    if (!global.SN_VOCI_PAGINA.includes(vociMenu)) global.SN_VOCI_PAGINA.push(vociMenu);
    return () => {
      apritori.delete(root);
      root.removeEventListener('click', alClic, true);
      root.removeEventListener('keydown', alClic, true);
    };
  }

  global.SN_FONTI_CITATE = Object.freeze({
    POSTO, normalizza, trova, chiave, nomeSito, sorgenti, controlla, nascondi, perIlDisco,
    conPosti, fumetto, html, indirizzoConFrase, vociMenu, aggancia,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
