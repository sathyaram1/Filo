// Mittenti e siti fidati (#534): chi alza una fonte dalla classe 5 (autore ignoto) alla 3 (autore fidato, #530).
// Logica pura sullo stato salvato; chi lo salva è src/main/services/fiduciaStore.js. Non decide se un'azione parte.
// Regole: tests/unit/fiducia.test.mjs.

(function (global) {
  'use strict';

  // Elenchi da migliaia di corrispondenti ci stanno; oltre si rifiuta col numero, mai un taglio.
  const MAX_VOCI = 20000;
  // Dagli Inviati si rilegge una volta a settimana: chi scrive di rado non serve scoprirlo prima.
  const RILEGGI_INVIATI_MS = 7 * 24 * 3600 * 1000;

  const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/;
  const EMAIL_IN_TESTO = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

  // Piattaforme dove scrive chiunque: lì una pagina non ha un autore solo, qualunque cosa mostri.
  const SITI_DI_MOLTI = [
    'youtube.com', 'reddit.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com',
    'threads.net', 'bsky.app', 'mastodon.social', 'linkedin.com', 'medium.com', 'substack.com', 'tumblr.com',
    'pinterest.com', 'quora.com', 'stackoverflow.com', 'stackexchange.com', 'github.com', 'gitlab.com',
    'wikipedia.org', 'fandom.com', 'blogspot.com', 'wordpress.com', 'tripadvisor.com', 'tripadvisor.it',
    'discord.com', 'telegram.me', 't.me', 'twitch.tv', 'vimeo.com', 'soundcloud.com', 'docs.google.com',
    'sites.google.com', 'drive.google.com', 'notion.site', 'pastebin.com',
  ];

  function testo(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  function indirizzo(v) {
    let s = testo(v).trim().replace(/^mailto:/i, '');
    const dentro = s.match(/<([^<>]+)>/);
    if (dentro) s = dentro[1];
    else {
      const m = s.match(EMAIL_IN_TESTO);
      if (m && m[0].length !== s.length) s = m[0];
    }
    s = s.trim().replace(/\.+$/, '').toLowerCase();
    return EMAIL.test(s) && s.length <= 254 ? s : '';
  }

  function sito(v) {
    let s = testo(v).trim().toLowerCase();
    if (!s) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
      try { s = new URL(s).hostname; } catch (_) { return ''; }
    } else {
      s = s.replace(/^\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
    }
    s = s.replace(/\.+$/, '').replace(/^www\./, '');
    const N = global.SN_NOMI_SITO;
    const valido = N ? N.valido(s) : /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(s);
    return valido && s.length <= 253 ? s : '';
  }

  function hostDi(url) {
    try { return new URL(testo(url)).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return sito(url); }
  }

  function sottoSito(host, s) {
    const h = testo(host).toLowerCase().replace(/^www\./, '');
    return !!h && !!s && (h === s || h.endsWith(`.${s}`));
  }

  function vuoto() {
    return { mittenti: [], siti: [], tolti: [], inviati: {} };
  }

  // Uno stato già ripulito porta il segno e non si rifà a ogni domanda: l'elenco di una casella ne fa decine.
  function norm(stato) { return stato && stato._norm === true ? stato : normalizza(stato); }

  function normalizza(stato) {
    const s = stato && typeof stato === 'object' ? stato : {};
    const out = vuoto();
    Object.defineProperty(out, '_norm', { value: true });
    const visti = new Set();
    for (const m of Array.isArray(s.mittenti) ? s.mittenti : []) {
      const a = indirizzo(m && m.indirizzo);
      if (!a || visti.has(a)) continue;
      visti.add(a);
      out.mittenti.push({ indirizzo: a, via: testo(m.via) || 'chat', dal: Number(m.dal) || 0 });
    }
    const siti = new Set();
    for (const x of Array.isArray(s.siti) ? s.siti : []) {
      const h = sito(x && x.sito);
      if (!h || siti.has(h)) continue;
      siti.add(h);
      out.siti.push({ sito: h, via: testo(x.via) || 'chat', dal: Number(x.dal) || 0 });
    }
    out.tolti = [...new Set((Array.isArray(s.tolti) ? s.tolti : []).map(indirizzo).filter(Boolean))];
    if (s.inviati && typeof s.inviati === 'object') {
      for (const [k, v] of Object.entries(s.inviati)) {
        if (Number.isFinite(Number(v))) out.inviati[testo(k).toLowerCase()] = Number(v);
      }
    }
    return out;
  }

  function fidatoMittente(stato, addr) {
    const a = indirizzo(addr);
    return !!a && norm(stato).mittenti.some((m) => m.indirizzo === a);
  }

  function sitoFidato(stato, urlOHost) {
    const h = hostDi(urlOHost);
    return norm(stato).siti.find((x) => sottoSito(h, x.sito)) || null;
  }

  // La fonte nella forma di #530: { classe, campo, chiave, motivo }. Un mittente si riconosce dall'indirizzo,
  // mai dal nome mostrato, che chiunque può scegliersi.
  function fonteMittente(stato, addr) {
    const a = indirizzo(addr);
    const fidato = !!a && fidatoMittente(stato, a);
    return {
      classe: fidato ? 3 : 5,
      campo: 'posta',
      chiave: `posta:${a || 'sconosciuto'}`,
      motivo: fidato ? `ho letto una mail di ${a}, mittente fidato` : `ho letto una mail di ${a || 'un mittente senza indirizzo'}`,
    };
  }

  function fonteSito(stato, url) {
    const h = hostDi(url);
    const f = sitoFidato(stato, url);
    return {
      classe: f ? 3 : 5,
      campo: 'web',
      chiave: `web:${f ? f.sito : (h || 'pagina')}`,
      motivo: f ? `ho letto ${h}, sito fidato` : `ho letto la pagina ${h || 'aperta'}`,
    };
  }

  // La classe peggiore fra quelle lette: è lei che decide quanto il compito resta pulito.
  function peggiore(fonti) {
    let p = null;
    for (const f of Array.isArray(fonti) ? fonti : []) {
      if (f && Number.isInteger(f.classe) && (!p || f.classe > p.classe)) p = f;
    }
    return p;
  }

  function aggiungi(stato, { mittente, sito: s, via = 'chat', ora = Date.now() } = {}) {
    const st = normalizza(stato);
    if (mittente != null) {
      const a = indirizzo(mittente);
      if (!a) return { stato: st, aggiunto: false, errore: 'indirizzo non valido' };
      if (st.mittenti.some((m) => m.indirizzo === a)) return { stato: st, aggiunto: false, voce: a };
      if (st.mittenti.length >= MAX_VOCI) return { stato: st, aggiunto: false, errore: `l'elenco ha già ${MAX_VOCI} mittenti` };
      st.mittenti.push({ indirizzo: a, via, dal: ora });
      st.tolti = st.tolti.filter((x) => x !== a);
      return { stato: st, aggiunto: true, voce: a };
    }
    const h = sito(s);
    if (!h) return { stato: st, aggiunto: false, errore: 'sito non valido' };
    if (st.siti.some((x) => x.sito === h)) return { stato: st, aggiunto: false, voce: h };
    if (st.siti.length >= MAX_VOCI) return { stato: st, aggiunto: false, errore: `l'elenco ha già ${MAX_VOCI} siti` };
    st.siti.push({ sito: h, via, dal: ora });
    return { stato: st, aggiunto: true, voce: h };
  }

  // Un mittente tolto a mano resta tolto: la prossima lettura degli Inviati non lo rimette.
  function togli(stato, { mittente, sito: s } = {}) {
    const st = normalizza(stato);
    if (mittente != null) {
      const a = indirizzo(mittente) || testo(mittente).trim().toLowerCase();
      const prima = st.mittenti.length;
      st.mittenti = st.mittenti.filter((m) => m.indirizzo !== a);
      if (indirizzo(a) && !st.tolti.includes(a)) st.tolti.push(a);
      return { stato: st, tolto: st.mittenti.length < prima, voce: a };
    }
    const h = sito(s) || testo(s).trim().toLowerCase();
    const prima = st.siti.length;
    st.siti = st.siti.filter((x) => x.sito !== h);
    return { stato: st, tolto: st.siti.length < prima, voce: h };
  }

  function inviatiDaRileggere(stato, account, ora = Date.now()) {
    const t = norm(stato).inviati[testo(account).toLowerCase() || '?'];
    return !t || ora - t > RILEGGI_INVIATI_MS;
  }

  // Gli indirizzi a cui l'utente ha scritto entrano da soli: rispondere a qualcuno è già fidarsene.
  function daInviati(stato, account, indirizzi, ora = Date.now()) {
    let st = normalizza(stato);
    const proprio = indirizzo(account);
    const nuovi = [];
    for (const x of Array.isArray(indirizzi) ? indirizzi : []) {
      const a = indirizzo(x);
      if (!a || a === proprio || st.tolti.includes(a) || st.mittenti.some((m) => m.indirizzo === a)) continue;
      const r = aggiungi(st, { mittente: a, via: 'inviati', ora });
      if (!r.aggiunto) break;
      st = r.stato;
      nuovi.push(a);
    }
    st.inviati[testo(account).toLowerCase() || '?'] = ora;
    return { stato: st, nuovi };
  }

  function piattaformaDiMolti(urlOHost) {
    const h = hostDi(urlOHost);
    return SITI_DI_MOLTI.some((s) => sottoSito(h, s));
  }

  // `segnali` li raccoglie la pagina aperta (campo per commentare, editor di post, nomi di autori diversi).
  function motiviMoltiAutori(urlOHost, segnali = null) {
    const motivi = [];
    if (piattaformaDiMolti(urlOHost)) motivi.push('è un sito dove pubblica chiunque');
    const g = segnali && typeof segnali === 'object' ? segnali : {};
    if (g.commenti) motivi.push('ha un campo per commentare');
    if (g.editor) motivi.push('ha un editor per scrivere post');
    if (Number(g.autori) >= 3) motivi.push(`mostra ${Number(g.autori)} autori diversi`);
    return motivi;
  }

  function sconsiglio(urlOHost, segnali = null) {
    const motivi = motiviMoltiAutori(urlOHost, segnali);
    if (!motivi.length) return '';
    const h = sito(urlOHost) || hostDi(urlOHost) || 'questo sito';
    const elenco = motivi.length > 1 ? `${motivi.slice(0, -1).join(', ')} e ${motivi[motivi.length - 1]}` : motivi[0];
    return `Te lo sconsiglio: ${h} ${elenco}, e quello che ci scrive uno sconosciuto passerebbe per fidato.`;
  }

  const VIA = { inviati: 'dagli Inviati', chat: 'segnato in chat', preferenze: 'aggiunto nelle Preferenze' };
  function nomeVia(via) { return VIA[via] || 'segnato a mano'; }

  global.SN_FIDUCIA = {
    MAX_VOCI, RILEGGI_INVIATI_MS, SITI_DI_MOLTI,
    nomeVia, indirizzo, sito, hostDi, vuoto, normalizza, fidatoMittente, sitoFidato, fonteMittente, fonteSito, peggiore,
    aggiungi, togli, inviatiDaRileggere, daInviati, piattaformaDiMolti, motiviMoltiAutori, sconsiglio,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
