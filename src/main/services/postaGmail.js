// La posta dalla scheda Gmail (#534): niente API né credenziali, Filo guida la pagina in cui l'utente è già entrato.
// Legge, cerca e prepara bozze; Invia lo preme sempre l'utente. Il gesto nella pagina lo fa paginaGuidata.js.
// Prove: tests/posta-gmail.spec.mjs (Gmail finto: quello vero non si prova in cloud).

const Schede = require('./schedeAperte');
const Store = require('./fiduciaStore');
const { MONDO } = require('./paginaGuidata');

const { chiama, attendi, assesta, lavoraSu, pausa } = Schede;

// Le prove servono un Gmail finto da un'altra origine; quello vero sta sempre su mail.google.com/mail.
function origine() {
  try { return new URL(process.env.FILO_GMAIL_ORIGIN || 'https://mail.google.com'); } catch (_) { return new URL('https://mail.google.com'); }
}

function eGmail(url) {
  let u = null;
  try { u = new URL(String(url)); } catch (_) { return false; }
  const o = origine();
  if (u.origin !== o.origin) return false;
  return o.hostname !== 'mail.google.com' || u.pathname.startsWith('/mail');
}

// Google che chiede di entrare prima di mostrare la posta: lì l'utente entra da sé, Filo non ci mette mano.
function accessoGmail(url) {
  return Schede.hostDi(url) === 'accounts.google.com' && /mail\.google\.com|service=mail/i.test(String(url));
}

function schedaGmail(win) {
  const tm = win && win._filoTabs;
  if (!tm) return null;
  const davanti = tm.tabs.find((t) => t.id === tm.activeId);
  if (davanti && eGmail(davanti.url)) return davanti;
  return Schede.inOrdine(tm).find((t) => eGmail(t.url)) || null;
}

const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// L'ultimo elenco mostrato al modello e l'ultima bozza scritta da Filo, per scheda: «leggi la 2», «cambia la bozza».
const ULTIMI = new WeakMap();
const BOZZE = new WeakMap();

const stato = (wc) => chiama(wc, 'posta.stato');

async function conFonti(righe) {
  const F = globalThis.SN_FIDUCIA;
  const fid = await Store.leggi();
  return (Array.isArray(righe) ? righe : []).map((r) => ({ ...r, fonte: F.fonteMittente(fid, r.indirizzo) }));
}

// Gli indirizzi a cui l'utente ha scritto, dalla cartella Inviati: una volta a settimana, poi indietro dov'era.
async function forseInviati(wc, st) {
  const F = globalThis.SN_FIDUCIA;
  const account = st.account || '?';
  if (!F.inviatiDaRileggere(await Store.leggi(), account)) return [];
  const primaUrl = wc.getURL();
  const r = await chiama(wc, 'posta.vaiA', ['inviati']);
  let nuovi = [];
  if (r && r.ok) {
    const arrivato = await attendi(async () => {
      const s = await stato(wc);
      return s && s.cartella === 'inviati' && s.vista === 'elenco';
    }, { tetto: 8000 });
    if (arrivato) {
      await assesta(wc);
      const righe = (await chiama(wc, 'posta.righe', [100])) || [];
      nuovi = await Store.daInviati(account, righe.flatMap((x) => (Array.isArray(x.indirizzi) ? x.indirizzi : [])));
    }
  }
  if (!nuovi.length) await Store.daInviati(account, []);
  if (wc.getURL() !== primaUrl) {
    try {
      if (wc.navigationHistory && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    } catch (_) {}
    await attendi(async () => {
      const s = await stato(wc);
      return s && s.dentro && s.cartella !== 'inviati';
    }, { tetto: 6000 });
    await assesta(wc);
  }
  return nuovi;
}

async function conGmail(win, fn, tabScelta = null) {
  if (!(await Schede.abilitata())) return { ok: false, errore: 'spento' };
  const tab = tabScelta || schedaGmail(win);
  if (!tab) {
    const tm = win && win._filoTabs;
    const login = tm && tm.tabs.some((t) => accessoGmail(t.url));
    return { ok: false, errore: login ? 'accesso' : 'nessuna-scheda' };
  }
  return lavoraSu(win, tab, async (wc) => {
    let st = null;
    await attendi(async () => {
      if (!eGmail(wc.getURL())) return true;
      st = await stato(wc);
      return st && st.dentro;
    }, { tetto: 20000, passo: 300 });
    const url = wc.getURL();
    if (!eGmail(url)) {
      return { ok: false, errore: Schede.vietata(url) || accessoGmail(url) ? 'accesso' : 'uscita', scheda: Schede.descriviScheda(tab) };
    }
    if (!st || !st.dentro) return { ok: false, errore: 'non-pronta', scheda: Schede.descriviScheda(tab) };
    const fidatiNuovi = await forseInviati(wc, st);
    if (fidatiNuovi.length || wc.getURL() !== st.url) st = (await stato(wc)) || st;
    const r = await fn(wc, st, tab);
    return { ...r, scheda: { ...Schede.descriviScheda(tab), titolo: wc.getTitle(), url: wc.getURL() }, account: st.account || '', fidatiNuovi };
  });
}

async function attendiElenco(wc, cartella) {
  return attendi(async () => {
    const s = await stato(wc);
    return s && s.vista === 'elenco' && (!cartella || s.cartella === cartella);
  }, { tetto: 8000 });
}

async function cercaIn(wc, query) {
  const prima = (await stato(wc)) || {};
  const firma = async () => JSON.stringify(((await chiama(wc, 'posta.righe', [20])) || []).map((x) => x.firma));
  const righePrima = await firma();
  const cambiato = async () => {
    const s = await stato(wc);
    if (!s || s.vista !== 'elenco') return false;
    return s.url !== prima.url || s.titolo !== prima.titolo || (await firma()) !== righePrima;
  };
  const r = await chiama(wc, 'posta.cerca', [query]);
  if (!r || !r.ok) return { ok: false, errore: 'nessuna-ricerca' };
  let ok = await attendi(cambiato, { tetto: 2500 });
  if (!ok) {
    await chiama(wc, 'posta.inviaRicerca');
    ok = await attendi(cambiato, { tetto: 3000 });
  }
  if (!ok && origine().hostname === 'mail.google.com') {
    // L'ultima strada è l'indirizzo che Gmail stesso scrive per una ricerca.
    const hash = `#search/${encodeURIComponent(query).replace(/%20/g, '+')}`;
    try { await wc.executeJavaScriptInIsolatedWorld(MONDO, [{ code: `location.hash = ${JSON.stringify(hash)}` }]); } catch (_) {}
    ok = await attendi(cambiato, { tetto: 5000 });
  }
  await assesta(wc);
  return { ok: true, cambiata: !!ok };
}

async function ripristina(wc, orig) {
  if (orig && orig.tipo === 'cerca' && orig.query) { await cercaIn(wc, orig.query); return; }
  const r = await chiama(wc, 'posta.vaiA', ['arrivo']);
  if (r && r.ok) await attendiElenco(wc, 'arrivo');
  await assesta(wc);
}

async function apriConversazione(wc, st, { numero = null, parole = '' } = {}) {
  const ultimi = ULTIMI.get(wc);
  const n = Number(numero);
  const numerata = Number.isInteger(n) && n > 0;
  const riga = numerata && ultimi ? ultimi.righe[n - 1] : null;
  if (!riga && !parole) {
    if (st.vista === 'conversazione' && !numerata) return { ok: true, giaAperta: true };
    return { ok: false, errore: numerata ? 'elenco-perso' : 'quale' };
  }
  const rif = riga ? { firma: riga.firma } : { parole: String(parole) };
  let r = await chiama(wc, 'posta.apriRiga', [rif]);
  if ((!r || !r.ok) && riga) {
    await ripristina(wc, ultimi.origine);
    r = await chiama(wc, 'posta.apriRiga', [rif]);
  }
  if ((!r || !r.ok) && parole) {
    const c = await cercaIn(wc, String(parole));
    if (c.ok) r = await chiama(wc, 'posta.apriRiga', [{ i: 1 }]);
  }
  if (!r || !r.ok) return { ok: false, errore: 'non-trovato' };
  const aperta = await attendi(async () => {
    const s = await stato(wc);
    return s && s.vista === 'conversazione';
  }, { tetto: 8000 });
  return aperta ? { ok: true, riga: r.riga } : { ok: false, errore: 'non-aperta' };
}

async function leggiConversazione(wc) {
  await assesta(wc);
  const e = await chiama(wc, 'posta.espandi');
  if (e && e.ok) { await pausa(200); await assesta(wc); }
  const conv = (await chiama(wc, 'posta.conversazione')) || {};
  const F = globalThis.SN_FIDUCIA;
  const fid = await Store.leggi();
  const messaggi = (Array.isArray(conv.messaggi) ? conv.messaggi : []).map((m) => ({ ...m, fonte: F.fonteMittente(fid, m.indirizzo) }));
  return { ok: true, vista: 'conversazione', oggetto: String(conv.oggetto || ''), messaggi };
}

async function leggiElencoQui(wc, st, origineElenco) {
  await assesta(wc);
  const righe = (await chiama(wc, 'posta.righe', [100])) || [];
  ULTIMI.set(wc, { righe, origine: origineElenco });
  return { ok: true, vista: 'elenco', cartella: st.cartella || '', righe: await conFonti(righe) };
}

async function elenco(win) {
  return conGmail(win, async (wc, st) => {
    let s = st;
    if (st.cartella !== 'arrivo' || st.vista !== 'elenco') {
      const r = await chiama(wc, 'posta.vaiA', ['arrivo']);
      if (r && r.ok) s = (await attendiElenco(wc, 'arrivo')) ? await stato(wc) : st;
    }
    return leggiElencoQui(wc, s, { tipo: 'arrivo' });
  });
}

async function cerca(win, { query } = {}) {
  const q = String(query == null ? '' : query).trim();
  if (!q) return { ok: false, errore: 'vuota' };
  return conGmail(win, async (wc, st) => {
    const c = await cercaIn(wc, q);
    if (!c.ok) return { ok: false, errore: c.errore };
    const r = await leggiElencoQui(wc, (await stato(wc)) || st, { tipo: 'cerca', query: q });
    return { ...r, query: q, cambiata: c.cambiata };
  });
}

async function leggiMessaggio(win, { numero = null, cerca: parole = '' } = {}) {
  return conGmail(win, async (wc, st) => {
    const ap = await apriConversazione(wc, st, { numero, parole });
    if (!ap.ok) return ap;
    return leggiConversazione(wc);
  });
}

// Quello che c'è sullo schermo della scheda: un elenco o una conversazione, ogni mail con la classe del suo mittente.
async function leggiVista(win, tab) {
  return conGmail(win, async (wc, st) => (st.vista === 'conversazione'
    ? leggiConversazione(wc)
    : leggiElencoQui(wc, st, { tipo: st.cartella === 'arrivo' ? 'arrivo' : 'vista' })), tab);
}

// Una bozza lasciata aperta nella scheda: l'utente la rilegge e preme lui Invia.
async function bozza(win, { a = '', oggetto = '', testo = '', rispondi = null, tutti = false } = {}) {
  const corpo = String(testo == null ? '' : testo);
  if (!corpo.trim()) return { ok: false, errore: 'testo-vuoto' };
  const risposta = rispondi != null && rispondi !== '' && rispondi !== false;
  if (!risposta && !String(a || '').trim()) return { ok: false, errore: 'manca-destinatario' };
  return conGmail(win, async (wc, st) => {
    const mia = BOZZE.get(wc) || null;
    if (risposta) {
      const daQui = rispondi === true || /^(true|questa|questo|aperta|corrente)$/i.test(String(rispondi).trim());
      if (!(daQui && st.vista === 'conversazione')) {
        const n = Number(rispondi);
        const ap = await apriConversazione(wc, st, Number.isInteger(n) && n > 0 ? { numero: n } : { parole: daQui ? '' : String(rispondi) });
        if (!ap.ok) return ap;
      }
      await assesta(wc);
      const f = await chiama(wc, 'posta.bozzaAperta');
      if (!f || !f.corpo || f.dialogo) {
        const c = await chiama(wc, 'posta.apriRisposta', [!!tutti]);
        if (!c || !c.ok) return { ok: false, errore: 'rispondi-mancante' };
      }
    } else {
      // Si riusa solo la finestra aperta da Filo: quella dell'utente, con quello che ci ha scritto, non si tocca.
      const f = await chiama(wc, 'posta.bozzaAperta');
      const riusa = !!(f && f.corpo && f.dialogo && mia && mia.tipo === 'nuova');
      if (!riusa) {
        const c = await chiama(wc, 'posta.apriScrivi');
        if (!c || !c.ok) return { ok: false, errore: 'scrivi-mancante' };
      }
    }
    const pronta = await attendi(async () => {
      const f = await chiama(wc, 'posta.bozzaAperta');
      return f && f.corpo && (risposta ? true : f.a);
    }, { tetto: 8000 });
    if (!pronta) return { ok: false, errore: 'bozza-non-aperta' };
    const r = await chiama(wc, 'posta.compila', [{
      a: risposta ? '' : String(a), oggetto: risposta ? '' : String(oggetto || ''), testo: corpo, prima: mia ? mia.testo : '',
    }]);
    if (!r || !r.ok) return { ok: false, errore: (r && r.motivo) || 'bozza-non-scritta' };
    await assesta(wc);
    const v = (await chiama(wc, 'posta.letturaBozza')) || {};
    const scritto = norm(v.testo).replace(/\s+/g, '').includes(norm(corpo).replace(/\s+/g, '').slice(0, 300));
    if (scritto) BOZZE.set(wc, { tipo: risposta ? 'risposta' : 'nuova', testo: corpo });
    return {
      ok: scritto, errore: scritto ? '' : 'bozza-non-scritta', risposta,
      destinatari: Array.isArray(v.destinatari) ? v.destinatari : [], oggetto: String(v.oggetto || ''), testo: String(v.testo || ''),
    };
  });
}

module.exports = { eGmail, accessoGmail, schedaGmail, elenco, cerca, leggiMessaggio, leggiVista, bozza };
