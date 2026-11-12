// Il testo scritto nei campi dei siti che non si perde (#2378): chiave della pagina, firma dei campi, abbinamento al
// ritorno, scadenza e tetti. Logica pura: il disco lo tiene src/main/services/testoDeiCampi.js, la pagina
// src/content/testoDeiCampi.js; prove in tests/unit/testoDeiCampi.test.mjs e tests/testo-dei-campi.spec.mjs.

(function (global) {
  'use strict';

  const GIORNI = [1, 7, 30];
  const GIORNI_DI_SERIE = 7;
  // Tetti larghi: un messaggio lunghissimo sta in decine di migliaia di caratteri. Oltre il tetto il campo non si
  // conserva affatto, e la risposta al content script lo dice (`troppo`): mai un pezzo tagliato.
  const VALORE_MAX = 1000000;
  const CAMPI_PER_PAGINA = 200;
  const TOTALE_MAX = 20000000;
  const TESTO_FIRMA = 200;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Solo i campi dove si scrive testo libero: una data, un colore o una casella hanno il loro modo di tornare.
  const TIPI = /^(text|email|url|tel|number)$/;

  function opzioni(settings) {
    const t = (settings && settings.testoDeiCampi) || {};
    const g = Number(t.giorni);
    return { attivo: t.attivo !== false, giorni: GIORNI.includes(g) ? g : GIORNI_DI_SERIE };
  }

  // La pagina come la si ritrova dopo una ricarica, una riapertura o un riavvio: l'ancora non conta.
  function chiavePagina(url) {
    let u = null;
    try { u = new URL(String(url == null ? '' : url)); } catch (_) { return ''; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    u.hash = '';
    return u.href;
  }

  const corto = (s) => String(s == null ? '' : s).slice(0, TESTO_FIRMA);
  const intero = (n) => (Number.isSafeInteger(n) && n >= 0 && n < 100000 ? n : 0);

  // { tag: 'input'|'textarea', tipo, id, nome, etichetta, ordine }; null se non descrive un campo di testo.
  function firmaPulita(f) {
    if (!f || typeof f !== 'object') return null;
    const tag = String(f.tag || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return null;
    const tipo = tag === 'textarea' ? '' : String(f.tipo || 'text').toLowerCase();
    if (tag === 'input' && !TIPI.test(tipo)) return null;
    return { tag, tipo, id: corto(f.id), nome: corto(f.nome), etichetta: corto(f.etichetta), ordine: intero(f.ordine) };
  }

  function stessaFirma(a, b) {
    return !!a && !!b && a.tag === b.tag && a.tipo === b.tipo && a.id === b.id && a.nome === b.nome
      && a.etichetta === b.etichetta && a.ordine === b.ordine;
  }

  const tipoDi = (f) => `${f.tag}|${f.tipo}`;
  // Le chiavi con cui un campo si riconosce, dalla più sicura: l'id, il nome, l'etichetta. Senza nessuna delle tre resta
  // l'ordine, solo se di quel tipo c'è un campo anonimo soltanto, prima e adesso: altrimenti il testo finirebbe altrove.
  const PASSI = [
    (f) => (f.id ? `id|${tipoDi(f)}|${f.id}` : ''),
    (f) => (f.nome ? `nome|${tipoDi(f)}|${f.nome}` : ''),
    (f) => (f.etichetta ? `etichetta|${tipoDi(f)}|${f.etichetta}` : ''),
  ];
  const anonimo = (f) => !f.id && !f.nome && !f.etichetta;

  function gruppi(lista, chiave) {
    const out = new Map();
    for (const x of lista) {
      const k = chiave(x.firma);
      if (!k) continue;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(x);
    }
    for (const g of out.values()) g.sort((a, b) => a.firma.ordine - b.firma.ordine);
    return out;
  }

  // `salvati` [{ firma, valore }], `presenti` [{ firma, indice }] → [{ indice, valore, da }], `da` la posizione in
  // `salvati`. Nello stesso gruppo i campi si appaiano in ordine di pagina: due «commento» uguali restano al loro posto.
  function abbina(salvati, presenti) {
    let restoS = (Array.isArray(salvati) ? salvati : []).map((x, da) => (x ? { ...x, da } : null))
      .filter((x) => x && x.firma && typeof x.valore === 'string');
    let restoP = (Array.isArray(presenti) ? presenti : []).filter((x) => x && x.firma);
    const out = [];
    for (const passo of PASSI) {
      const gp = gruppi(restoP, passo);
      const usatiS = new Set();
      const usatiP = new Set();
      for (const [k, gs] of gruppi(restoS, passo)) {
        const qui = gp.get(k) || [];
        for (let i = 0; i < gs.length && i < qui.length; i++) {
          out.push({ indice: qui[i].indice, valore: gs[i].valore, da: gs[i].da });
          usatiS.add(gs[i]);
          usatiP.add(qui[i]);
        }
      }
      restoS = restoS.filter((x) => !usatiS.has(x));
      restoP = restoP.filter((x) => !usatiP.has(x));
    }
    const soli = (lista) => {
      const g = new Map();
      for (const x of lista) {
        if (!anonimo(x.firma)) continue;
        const k = tipoDi(x.firma);
        g.set(k, g.has(k) ? null : x);
      }
      return g;
    };
    const sp = soli(restoP);
    for (const [k, s] of soli(restoS)) {
      const p = sp.get(k);
      if (s && p) out.push({ indice: p.indice, valore: s.valore, da: s.da });
    }
    return out;
  }

  // `dati` { [pagina]: { t, campi: [{ firma, valore, t }] } } → una copia senza lo scaduto e senza quello che non è un
  // campo valido. Il tetto totale non toglie niente di vecchio: rifiuta il nuovo (`pesoTotale` a chi scrive).
  function pota(dati, ora, giorni) {
    const limite = ora - (GIORNI.includes(giorni) ? giorni : GIORNI_DI_SERIE) * DAY_MS;
    const pagine = [];
    for (const [k, p] of Object.entries(dati && typeof dati === 'object' ? dati : {})) {
      if (!chiavePagina(k) || !p || !Array.isArray(p.campi)) continue;
      const campi = p.campi.filter((c) => c && firmaPulita(c.firma) && typeof c.valore === 'string' && c.valore
        && c.valore.length <= VALORE_MAX && Number(c.t) > limite && Number(c.t) <= ora + DAY_MS).slice(-CAMPI_PER_PAGINA);
      if (!campi.length) continue;
      pagine.push([k, { t: Math.max(...campi.map((c) => Number(c.t))), campi }]);
    }
    return Object.fromEntries(pagine);
  }

  function pesoTotale(dati) {
    let n = 0;
    for (const p of Object.values(dati || {})) for (const c of (p && p.campi) || []) n += String(c.valore || '').length;
    return n;
  }

  // Scrive nella pagina `p` (o la crea) un campo: valore vuoto = via. Torna la pagina, null se resta vuota.
  function aggiorna(p, firma, valore, ora) {
    const campi = (p && Array.isArray(p.campi) ? p.campi : []).filter((c) => !stessaFirma(c.firma, firma));
    if (valore) {
      campi.push({ firma, valore, t: ora });
      if (campi.length > CAMPI_PER_PAGINA) campi.shift();
    }
    return campi.length ? { t: ora, campi } : null;
  }

  global.SN_TESTO_CAMPI = {
    GIORNI, GIORNI_DI_SERIE, VALORE_MAX, CAMPI_PER_PAGINA, TOTALE_MAX, TIPI,
    opzioni, chiavePagina, firmaPulita, stessaFirma, abbina, pota, aggiorna, pesoTotale,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SN_TESTO_CAMPI;
})(typeof globalThis !== 'undefined' ? globalThis : self);
