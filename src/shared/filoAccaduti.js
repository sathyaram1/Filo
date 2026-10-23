// Gli accaduti del filo (#1561): cosa di un'azione, di una lettura del sistema o di una scrittura dell'editor diventa
// un evento. Logica pura: chi scrive è src/main/services/accaduti.js, la forma degli eventi src/shared/filoEventi.js.
// Prove: tests/unit/filoAccaduti.test.mjs.

(function (global) {
  'use strict';

  const stringa = (s) => typeof s === 'string' && s.length > 0;
  const oggetto = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

  // I campi con `_` li scrive Filo sull'azione (esiti, conferme, id della chiamata): l'azione è quello che è stato chiesto.
  function parametriAzione(action) {
    const out = {};
    if (!oggetto(action)) return out;
    for (const k of Object.keys(action)) {
      if (k === 'type' || k.startsWith('_') || action[k] === undefined || typeof action[k] === 'function') continue;
      out[k] = action[k];
    }
    try { return JSON.parse(JSON.stringify(out)); } catch (_) { return {}; }
  }

  // L'esito come lo vede chi rilegge: fatta o no, perché no, cosa ha cambiato. Il contenuto letto (pagine, documenti,
  // risultati) resta in memoria con la sua chat, come per il modello: qui non c'è.
  function esitoAzione(res, { fatto = '', cambi = [] } = {}) {
    const r = oggetto(res) ? res : {};
    const o = oggetto(r.output) ? r.output : {};
    const esito = { eseguita: r.executed === true };
    if (Number.isInteger(r.needsConfirm)) esito.chiede = r.needsConfirm;
    else if (r.domanda) esito.chiede = 'conferma scritta';
    if (r.rejected) esito.rifiutata = true;
    if (stringa(o.blocked)) esito.fermata = o.blocked;
    const errore = [r.error, o.error, o.rifiuto, o.reason].find(stringa);
    if (errore) esito.errore = errore;
    if (esito.eseguita && stringa(fatto)) esito.fatto = fatto;
    const ids = (Array.isArray(cambi) ? cambi : []).map((c) => (c && c.id) || c).filter(stringa);
    if (ids.length) esito.cambi = ids;
    return esito;
  }

  // La ricerca scritta nell'indirizzo di un motore o di un sito («cercato orche su YouTube»). Null se non è una ricerca.
  const MOTORI = [
    { host: /(^|\.)google\.[a-z.]+$/, percorso: /^\/search$/, chiavi: ['q'], nome: 'Google' },
    { host: /(^|\.)bing\.com$/, percorso: /^\/search$/, chiavi: ['q'], nome: 'Bing' },
    { host: /(^|\.)duckduckgo\.com$/, percorso: /^\/(html\/?)?$/, chiavi: ['q'], nome: 'DuckDuckGo' },
    { host: /(^|\.)search\.yahoo\.com$/, percorso: /^\/search/, chiavi: ['p'], nome: 'Yahoo' },
    { host: /(^|\.)ecosia\.org$/, percorso: /^\/search$/, chiavi: ['q'], nome: 'Ecosia' },
    { host: /(^|\.)startpage\.com$/, percorso: /^\/(sp\/)?search/, chiavi: ['query', 'q'], nome: 'Startpage' },
    { host: /(^|\.)search\.brave\.com$/, percorso: /^\/search$/, chiavi: ['q'], nome: 'Brave' },
    { host: /(^|\.)qwant\.com$/, percorso: /^\/?$/, chiavi: ['q'], nome: 'Qwant' },
    { host: /(^|\.)yandex\.[a-z.]+$/, percorso: /^\/search/, chiavi: ['text'], nome: 'Yandex' },
    { host: /(^|\.)baidu\.com$/, percorso: /^\/s$/, chiavi: ['wd'], nome: 'Baidu' },
    { host: /(^|\.)youtube\.com$/, percorso: /^\/results$/, chiavi: ['search_query'], nome: 'YouTube' },
    { host: /(^|\.)amazon\.[a-z.]+$/, percorso: /^\/s\/?$/, chiavi: ['k'], nome: 'Amazon' },
    { host: /(^|\.)ebay\.[a-z.]+$/, percorso: /^\/sch\//, chiavi: ['_nkw'], nome: 'eBay' },
    { host: /(^|\.)wikipedia\.org$/, percorso: /^\/w\/index\.php$/, chiavi: ['search'], nome: 'Wikipedia' },
  ];
  const PERCORSO_CERCA = /(^|\/)(search|cerca|ricerca|results|risultati|find|suche|recherche|buscar)(\/|$|\.)/i;
  const CHIAVI_CERCA = ['q', 'query', 'search', 'search_query', 's', 'k', 'term', 'keyword', 'keywords', 'text'];

  function ricercaNellIndirizzo(url) {
    let u;
    try { u = new URL(String(url || '')); } catch (_) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const leggi = (chiavi) => {
      for (const k of chiavi) {
        const v = (u.searchParams.get(k) || '').replace(/\s+/g, ' ').trim();
        if (v) return v;
      }
      return '';
    };
    const motore = MOTORI.find((m) => m.host.test(host));
    if (motore) {
      if (!motore.percorso.test(u.pathname)) return null;
      const testo = leggi(motore.chiavi);
      return testo ? { testo, sito: motore.nome } : null;
    }
    const SC = global.SN_SITI_COMUNI;
    const r = SC && typeof SC.riconosci === 'function' ? SC.riconosci(u.href) : null;
    if (r && r.tipo === 'cerca' && stringa(r.parole)) return { testo: r.parole.trim(), sito: r.sito };
    if (!PERCORSO_CERCA.test(u.pathname)) return null;
    const testo = leggi(CHIAVI_CERCA);
    return testo ? { testo, sito: host } : null;
  }

  // ── Il sistema: solo i cambi che contano, non ogni punto di batteria ──
  // 15 è la batteria «bassa» della barra (src/shared/sistema.js), 5 quella che sta per spegnersi.
  const SOGLIE_BATTERIA = Object.freeze([15, 5]);

  function cambiSistema(prima, dopo) {
    const out = [];
    if (!oggetto(prima) || !oggetto(dopo)) return out;
    const ra = prima.rete;
    const rb = dopo.rete;
    if (oggetto(ra) && oggetto(rb) && typeof ra.online === 'boolean' && typeof rb.online === 'boolean' && ra.online !== rb.online) {
      out.push({ cosa: 'rete', online: rb.online, ...(rb.online && stringa(rb.nome) ? { nome: rb.nome } : {}) });
    }
    const ba = prima.batteria;
    const bb = dopo.batteria;
    if (oggetto(ba) && oggetto(bb) && Number.isFinite(ba.livello) && Number.isFinite(bb.livello) && !bb.collegata && !bb.inCarica) {
      const passate = SOGLIE_BATTERIA.filter((s) => ba.livello > s && bb.livello <= s);
      if (passate.length) out.push({ cosa: 'batteria', livello: bb.livello, soglia: Math.min(...passate) });
    }
    const da = prima.bluetooth && Array.isArray(prima.bluetooth.dispositivi) ? prima.bluetooth.dispositivi : null;
    const db = dopo.bluetooth && Array.isArray(dopo.bluetooth.dispositivi) ? dopo.bluetooth.dispositivi : null;
    if (da && db) {
      for (const n of db) if (stringa(n) && !da.includes(n)) out.push({ cosa: 'bluetooth', dispositivo: n, collegato: true });
      for (const n of da) if (stringa(n) && !db.includes(n)) out.push({ cosa: 'bluetooth', dispositivo: n, collegato: false });
    }
    return out;
  }

  // ── I documenti dell'editor ─────────────────────────────────────────────
  // Chi scrive salva a ogni pausa: una sessione di scrittura è un evento, finché non resta ferma RAFFICA_MS.
  const RAFFICA_MS = 5 * 60 * 1000;
  const titoloDi = (f) => String((f && f.meta && f.meta.title) || '');
  const modificatoDi = (f) => (f && f.meta ? f.meta.modified : undefined);

  // `raffiche`: Map id → ultimo salvataggio visto, tenuta da chi osserva (la aggiorna qui). Prima del primo
  // salvataggio (una collezione che non c'era) non è successo niente: è la copia di quella che l'editor aveva già.
  function cambiEditor(prima, dopo, { adesso = Date.now(), raffiche = new Map() } = {}) {
    const out = [];
    if (!oggetto(prima) || !Array.isArray(prima.files) || !oggetto(dopo) || !Array.isArray(dopo.files)) return out;
    const vecchi = new Map(prima.files.filter((f) => f && stringa(f.id)).map((f) => [f.id, f]));
    const nuovi = new Map(dopo.files.filter((f) => f && stringa(f.id)).map((f) => [f.id, f]));
    for (const [id, f] of nuovi) {
      const v = vecchi.get(id);
      if (!v) { out.push({ file: id, azione: 'creato', titolo: titoloDi(f) }); raffiche.set(id, adesso); continue; }
      if (titoloDi(v) !== titoloDi(f)) out.push({ file: id, azione: 'rinominato', titolo: titoloDi(f), prima: titoloDi(v) });
      if (modificatoDi(v) !== modificatoDi(f)) {
        const ultimo = raffiche.get(id);
        if (!(ultimo != null && adesso - ultimo < RAFFICA_MS)) out.push({ file: id, azione: 'scritto', titolo: titoloDi(f) });
        raffiche.set(id, adesso);
      }
    }
    for (const [id, f] of vecchi) {
      if (!nuovi.has(id)) { out.push({ file: id, azione: 'tolto', titolo: titoloDi(f) }); raffiche.delete(id); }
    }
    // L'editor segna con `apertoAlle` il documento che l'utente mette davanti, anche solo per leggerlo: un'ora più nuova
    // di quelle viste è un'apertura. Due editor aperti si rubano il documento davanti a ogni salvataggio, ognuno con la
    // sua ora vecchia: senza un'ora nuova, un documento rimasto davanti da poco non si riapre a ogni giro.
    const att = dopo.activeId;
    if (stringa(att) && nuovi.has(att)) {
      const k = `aperto:${att}`;
      const ultimo = raffiche.get(k);
      const vista = raffiche.get('apertoAlle') || (stringa(prima.apertoAlle) ? prima.apertoAlle : '');
      const segnato = stringa(dopo.apertoAlle) && dopo.apertoAlle > vista;
      if (segnato) raffiche.set('apertoAlle', dopo.apertoAlle);
      const cambiato = att !== prima.activeId && !(ultimo != null && adesso - ultimo < RAFFICA_MS);
      if (vecchi.has(att) && (segnato || cambiato)) out.push({ file: att, azione: 'aperto', titolo: titoloDi(nuovi.get(att)) });
      raffiche.set(k, adesso);
    }
    return out;
  }

  // ── I gesti dell'interfaccia che fanno un'azione del catalogo ───────────
  // Il tasto che va dritto al punto che fa la cosa lascia la stessa azione della chat: il messaggio dice quale. Dove il
  // punto è uno solo per tutte le strade (aprire un file, dargli un nome, instradare una scheda) il segno nasce lì.
  // Ogni azione del catalogo dichiara dove nasce il suo segno: tests/unit/filoAccaduti.test.mjs.
  const testo = (s) => (typeof s === 'string' ? s.trim() : '');
  const riuscito = (r) => oggetto(r) && r.ok !== false && !stringa(r.error);
  const erroreDi = (r) => (oggetto(r) ? [r.error, r.errore, r.frase].find(stringa) : '') || 'non riuscita';
  const GESTI = {
    filo_installa_aggiornamento: {
      azione: () => ({ type: 'INSTALLA_AGGIORNAMENTO' }),
      riuscita: (r) => riuscito(r) && r.stato !== 'errore' && r.stato !== 'rifiutata',
    },
    aggiornamento_installa: { azione: () => ({ type: 'INSTALLA_AGGIORNAMENTO', riavvio: true }), riuscita: riuscito },
    filo_memory_edit: {
      azione: (m) => (testo(m.testo) ? { type: 'CORREGGI_MEMORIA', nuovo: testo(m.testo) } : { type: 'DIMENTICA', riga: m.via }),
      riuscita: (r) => riuscito(r) && (r.corretta === true || r.tolta === true),
    },
    filo_memory_forget: {
      azione: (m) => (stringa(m.sempreAperta) ? { type: 'NON_TENERE_APERTA', sito: m.sempreAperta }
        : { type: 'DIMENTICA', ...(oggetto(m.lezione) ? { lezione: m.lezione } : { modulo: m.modulo, riga: m.riga }) }),
      riuscita: (r) => riuscito(r) && r.tolta === true,
    },
    filo_memory_forever: { azione: (m) => ({ type: 'DIMENTICA', per_sempre: true, id: m.id }), riuscita: (r) => riuscito(r) && !!r.cancellata },
    permessi_siti_togli: {
      azione: (m) => ({ type: 'TOGLI_PERMESSO_SITO', sito: m.origine, permesso: m.parte }),
      riuscita: (r) => riuscito(r) && r.ok === true,
    },
    // Le schede chiuse tolte dall'archivio: dal pannello che la chat propone, o dalla Cronologia.
    delete_archived_tabs: {
      azione: (m) => ({ type: 'CANCELLA_ARCHIVIO', quante: Array.isArray(m.ids) ? m.ids.length : 0 }),
      riuscita: riuscito,
    },
    remove_archived_tab: { azione: () => ({ type: 'CANCELLA_ARCHIVIO', quante: 1 }), riuscita: riuscito },
    clear_archived_tabs: { azione: () => ({ type: 'CANCELLA_ARCHIVIO', tutte: true }), riuscita: riuscito },
    carte_home_modifica: { azione: (m) => (oggetto(m.mossa) ? { ...m.mossa, type: 'CARTA_HOME' } : null), riuscita: riuscito },
    calendar_add: { azione: (m) => (oggetto(m.evento) ? { ...m.evento, type: 'EVENTO_CALENDARIO' } : null), riuscita: riuscito },
    submit_feedback: {
      azione: (m) => {
        const p = oggetto(m.payload) ? m.payload : {};
        return testo(p.text) ? { type: 'INVIA_FEEDBACK', testo: testo(p.text), ...(stringa(p.url) ? { pagina: p.url } : {}) } : null;
      },
      riuscita: riuscito,
    },
  };

  // L'azione e il suo esito nella forma di executeFiloAction, o null se il messaggio non è un gesto del catalogo o il
  // main l'ha respinto (un mittente che non può, una richiesta malformata: non è successo niente).
  function gestoComeAzione(tipoMsg, msg, res) {
    const g = Object.prototype.hasOwnProperty.call(GESTI, tipoMsg) ? GESTI[tipoMsg] : null;
    if (!g || !oggetto(msg)) return null;
    if (oggetto(res) && (res.code === 'forbidden' || res.error === 'forbidden' || res.error === 'bad_request')) return null;
    let action = null;
    try { action = g.azione(msg); } catch (_) { action = null; }
    if (!action) return null;
    const ok = g.riuscita(res);
    return { action, res: { executed: ok, ...(ok ? {} : { error: erroreDi(res) }) } };
  }

  global.SN_FILO_ACCADUTI = {
    parametriAzione, esitoAzione, ricercaNellIndirizzo, cambiSistema, SOGLIE_BATTERIA, cambiEditor, RAFFICA_MS,
    GESTI, gestoComeAzione,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
