// Le richieste che il main fa per conto di una scheda (anteprima di un link, llms.txt, byte di un'immagine): escono come
// uscirebbero da lei, dalla sua sessione (proxy, certificati, cache, identità, protezioni, cookie concessi), mai verso la
// rete interna e col Referer ridotto all'origine. Prove: tests/unit/perContoDellaScheda.test.mjs, tests/proxy-tab.spec.mjs.

'use strict';

const netNode = require('node:net');
const { assertPublicHost, isPrivateAddr } = require('./safe-fetch');
const Sito = require('../../shared/stessoSito');

// ── Referer ────────────────────────────────────────────────────────────────

const POLITICHE = new Set(['no-referrer', 'no-referrer-when-downgrade', 'same-origin', 'origin', 'strict-origin',
  'origin-when-cross-origin', 'strict-origin-when-cross-origin', 'unsafe-url']);
// I valori storici del <meta name="referrer">.
const VECCHIE = { never: 'no-referrer', always: 'unsafe-url', default: 'strict-origin-when-cross-origin', 'origin-when-crossorigin': 'origin-when-cross-origin' };

// Una dichiarazione («no-referrer, strict-origin» in un'intestazione) vale per l'ultimo valore che si capisce.
function politicaDi(testo) {
  let ultima = '';
  for (const p of String(testo || '').toLowerCase().split(',')) {
    const t = VECCHIE[p.trim()] || p.trim();
    if (POLITICHE.has(t)) ultima = t;
  }
  return ultima;
}

// Al massimo l'origine della pagina, niente da https a http, niente se la pagina (o l'elemento) chiede di tacerla.
// `politiche`: quelle dichiarate dalla pagina e dall'elemento; conta la più stretta.
function refererPerConto(pagina, destinazione, politiche = []) {
  let p;
  let d;
  try { p = new URL(String(pagina || '')); d = new URL(String(destinazione || '')); } catch (_) { return ''; }
  if (!/^https?:$/.test(p.protocol) || !/^https?:$/.test(d.protocol)) return '';
  const dette = (Array.isArray(politiche) ? politiche : [politiche]).map(politicaDi).filter(Boolean);
  if (dette.includes('no-referrer')) return '';
  if (dette.includes('same-origin') && p.origin !== d.origin) return '';
  if (p.protocol === 'https:' && d.protocol !== 'https:') return '';
  return p.origin + '/';
}

// La politica che un documento ha ricevuto con l'intestazione Referrer-Policy: la pagina non la può leggere, il main la
// vede arrivare (services/cookies.js, onCompleted). Per scheda e indirizzo del documento, senza il frammento.
const MAX_DOCUMENTI = 1000;
const politicheDocumenti = new Map();
const chiaveDocumento = (wcId, url) => `${wcId}|${String(url || '').split('#')[0]}`;

function ricordaPoliticaDocumento(d) {
  if (!d || (d.resourceType !== 'mainFrame' && d.resourceType !== 'subFrame') || d.webContentsId == null) return;
  const h = d.responseHeaders || {};
  const nome = Object.keys(h).find((k) => k.toLowerCase() === 'referrer-policy');
  const valore = nome ? politicaDi([].concat(h[nome]).join(',')) : '';
  const k = chiaveDocumento(d.webContentsId, d.url);
  politicheDocumenti.delete(k);
  if (!valore) return;
  politicheDocumenti.set(k, valore);
  while (politicheDocumenti.size > MAX_DOCUMENTI) politicheDocumenti.delete(politicheDocumenti.keys().next().value);
}

function politicaDocumento(wcId, url) {
  return politicheDocumenti.get(chiaveDocumento(wcId, url)) || '';
}

// In un riquadro conta il documento del riquadro, non quello della scheda.
function paginaDi(sender) {
  let f = '';
  try { f = String((sender && sender.frame && sender.frame.url) || ''); } catch (_) { f = ''; }
  return f || String((sender && (sender.url || (sender.tab && sender.tab.url))) || '');
}

// ── cookie ─────────────────────────────────────────────────────────────────

// Per i cookie http e https sono due siti; fuori dal web nessuno.
function sitoWeb(indirizzo) {
  let u;
  try { u = new URL(String(indirizzo || '')); } catch (_) { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  const s = Sito.sitoDi(u.href);
  return s ? `${u.protocol}//${s}` : '';
}

function stessoSitoWeb(a, b) {
  const s = sitoWeb(a);
  return !!s && s === sitoWeb(b);
}

// L'origine del documento che chiede, se lui e tutti i suoi antenati stanno su un sito solo; '' altrimenti: lì Chromium
// tratta ogni richiesta del documento come partita da un altro sito.
function origineDellaPagina(sender) {
  const origini = [];
  try {
    for (let f = sender && sender.frame, i = 0; f && i < 64; f = f.parent, i++) origini.push(String(f.origin || f.url || ''));
  } catch (_) { return ''; }
  origini.push(String((sender && (sender.url || (sender.tab && sender.tab.url))) || ''));
  if (!origini.every((o) => stessoSitoWeb(o, origini[0]))) return '';
  try { return new URL(origini[0]).origin; } catch (_) { return ''; }
}

// Con un iniziatore Chromium sceglie i cookie come per la pagina (SameSite): a un altro sito solo quelli che concede alle
// richieste altrui. Per un altro sito l'iniziatore è opaco: stessi cookie, e nessun blocco Cross-Origin-Resource-Policy in più.
function iniziatorePer(origine, url) {
  return origine && stessoSitoWeb(origine, url) ? origine : 'null';
}

// ── rete interna ───────────────────────────────────────────────────────────

const ATTESA_PROXY_MS = 3000;

// Dietro un proxy il nome lo risolve lui: chiederlo al DNS di casa direbbe dove va la scheda a chi la scheda evita.
// Una configurazione che può ripiegare su DIRECT («PROXY x; DIRECT») conta come diretta: il ripiego si collega da qui.
async function passaDalProxy(ses, url) {
  if (!ses || typeof ses.resolveProxy !== 'function') return false;
  let t = null;
  const tardi = new Promise((ok) => { t = setTimeout(() => ok(''), ATTESA_PROXY_MS); });
  try {
    const r = await Promise.race([Promise.resolve(ses.resolveProxy(url)).catch(() => ''), tardi]);
    return !!String(r || '').trim() && !/\bDIRECT\b/i.test(String(r));
  } finally {
    clearTimeout(t);
  }
}

// Gli indirizzi letterali e i nomi di casa si giudicano sempre; un nome qualsiasi col DNS solo se la richiesta va diretta,
// e col risolutore della sessione: è quello con cui la richiesta si collegherà, non un altro che può rispondere diverso.
async function controllaHost(ses, u) {
  const nudo = String(u.hostname || '').replace(/^\[(.*)\]$/, '$1').toLowerCase();
  const diCasa = netNode.isIP(nudo) || nudo === 'localhost' || nudo.endsWith('.localhost') || nudo.endsWith('.local');
  if (diCasa || !nudo) { await assertPublicHost(u.hostname); return; }
  if (await passaDalProxy(ses, u.href)) return;
  if (!ses || typeof ses.resolveHost !== 'function') { await assertPublicHost(u.hostname); return; }
  let risolto;
  try { risolto = await ses.resolveHost(nudo); } catch (_) { throw new Error('dns-failed'); }
  const indirizzi = ((risolto && risolto.endpoints) || []).map((x) => x && x.address).filter(Boolean);
  if (!indirizzi.length) throw new Error('dns-empty');
  if (indirizzi.some(isPrivateAddr)) throw new Error('blocked-private-address');
}

async function inReteInterna(ses, url) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  try { await controllaHost(ses, u); return false; } catch (e) { return !!e && e.message === 'blocked-private-address'; }
}

// ── la richiesta ───────────────────────────────────────────────────────────

function credenzialiProxy(ses) {
  try { return require('./proxyTab').credenzialiDellaSessione(ses); } catch (_) { return null; }
}

function intestazioni(grezze) {
  const h = new Headers();
  for (const [k, v] of Object.entries(grezze || {})) {
    for (const x of [].concat(v)) { try { h.append(k, String(x)); } catch (_) {} }
  }
  return h;
}

// Il corpo arriva a pezzi come dal fetch; chi smette di leggere chiude anche la connessione.
function corpoDi(res, req) {
  return new ReadableStream({
    start(ctrl) {
      const errore = (e) => { try { ctrl.error(e instanceof Error ? e : new Error('download interrotto')); } catch (_) {} };
      res.on('data', (b) => {
        try { ctrl.enqueue(new Uint8Array(b)); } catch (_) {}
        if (ctrl.desiredSize !== null && ctrl.desiredSize <= 0) { try { res.pause(); } catch (_) {} }
      });
      res.on('end', () => { try { ctrl.close(); } catch (_) {} });
      res.on('error', errore);
      res.on('aborted', () => errore(new Error('download interrotto')));
      req.on('error', errore);
    },
    pull() { try { res.resume(); } catch (_) {} },
    cancel() { try { req.abort(); } catch (_) {} },
  });
}

const SENZA_CORPO = new Set([101, 103, 204, 205, 304]);

// Un passo solo, senza seguire i rimandi: torna { rimando } o { risposta } (una Response del fetch). Il net di Electron
// e non il fetch della sessione: quello non sa né fermarsi a un rimando né rispondere al proxy che chiede la password.
function richiestaDiRete(ses, url, { headers = {}, credenziali = 'omit', iniziatore = '', referrerPolicy = 'no-referrer', signal } = {}) {
  const { net } = require('electron');
  return new Promise((resolve, reject) => {
    let finito = false;
    const fine = (fn, v) => { if (!finito) { finito = true; fn(v); } };
    let req;
    try {
      req = net.request({
        url, session: ses, method: 'GET', redirect: 'manual', credentials: credenziali,
        useSessionCookies: credenziali === 'include', referrerPolicy, ...(iniziatore ? { origin: iniziatore } : {}),
      });
    } catch (e) { reject(e); return; }
    const annulla = () => { try { req.abort(); } catch (_) {} fine(reject, new Error('aborted')); };
    if (signal) {
      if (signal.aborted) { annulla(); return; }
      signal.addEventListener('abort', annulla, { once: true });
    }
    for (const [k, v] of Object.entries(headers)) { if (v) { try { req.setHeader(k, v); } catch (_) {} } }
    req.on('login', (info, rispondi) => {
      const c = info && info.isProxy ? credenzialiProxy(ses) : null;
      if (c) rispondi(c.username, c.password); else rispondi();
    });
    req.on('redirect', (_status, _metodo, verso) => {
      fine(resolve, { rimando: verso });
      try { req.abort(); } catch (_) {}
    });
    req.on('response', (res) => {
      const status = res.statusCode || 0;
      let risposta;
      try {
        risposta = new Response(SENZA_CORPO.has(status) ? null : corpoDi(res, req), {
          status, statusText: res.statusMessage || '', headers: intestazioni(res.headers),
        });
      } catch (e) { try { req.abort(); } catch (_) {} fine(reject, e); return; }
      fine(resolve, { risposta });
    });
    req.on('error', (e) => fine(reject, e || new Error('richiesta fallita')));
    req.on('abort', () => fine(reject, new Error('aborted')));
    req.end();
  });
}

const dip = { richiesta: richiestaDiRete };

// GET per conto della scheda di `sender`. Torna una Response; lancia su schema, rete interna, rimando rifiutato.
//   credenziali       'omit' (anteprime, llms.txt) o 'include' (i byte di un'immagine, coi cookie che avrebbe la pagina)
//   conReferer        presenta la pagina come la presenterebbe lei, al massimo l'origine; `politiche` la stringono
//   redirectAmmesso   (partenza, prossimo) → vero se il rimando si segue
//   lanSeGiaDiPartenza  un indirizzo di casa in https si legge restando sulla sua origine (vedi safe-fetch.js)
//   lanSeLaPaginaCiSta  la rete di casa si raggiunge solo per una pagina che ci sta già (le foto del NAS)
async function perContoDellaScheda(sender, url, {
  credenziali = 'omit', accetta = '', signal, maxRedirect = 5, redirectAmmesso, conReferer = false, politiche = [],
  lanSeGiaDiPartenza = false, lanSeLaPaginaCiSta = false,
} = {}) {
  const wc = sender && sender.wc;
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) throw new Error('no-sender');
  const ses = wc.session;
  const pagina = paginaDi(sender);
  const dette = [politicaDocumento(wc.id, pagina), ...[].concat(politiche || [])];
  const origine = credenziali === 'include' ? origineDellaPagina(sender) : '';
  let ua = '';
  try { ua = typeof wc.getUserAgent === 'function' ? wc.getUserAgent() : ''; } catch (_) { ua = ''; }
  let paginaDiCasa = null;
  const paginaInCasa = async () => {
    if (paginaDiCasa === null) paginaDiCasa = await inReteInterna(ses, pagina);
    return paginaDiCasa;
  };
  let corrente = String(url || '');
  let partenza = null;
  let origineLan = null;
  for (let i = 0; i <= maxRedirect; i++) {
    let u;
    try { u = new URL(corrente); } catch (_) { throw new Error('bad-url'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('blocked-scheme');
    if (!partenza) partenza = u;
    if (origineLan) {
      if (u.origin !== origineLan) throw new Error('blocked-private-address');
    } else {
      try {
        await controllaHost(ses, u);
      } catch (e) {
        if (!e || e.message !== 'blocked-private-address') throw e;
        if (i === 0 && lanSeGiaDiPartenza && u.protocol === 'https:') origineLan = u.origin;
        else if (!(lanSeLaPaginaCiSta && await paginaInCasa())) throw e;
      }
    }
    const referer = conReferer ? refererPerConto(pagina, u.href, dette) : '';
    const headers = { 'User-Agent': ua, Accept: accetta, Referer: referer };
    // La politica dichiarata deve dare lo stesso Referer che mandiamo: il servizio di rete di Chromium annulla le
    // richieste che non tornano.
    const iniziatore = credenziali === 'include' ? iniziatorePer(origine, u.href) : '';
    const passo = await dip.richiesta(ses, u.href, { headers, credenziali, iniziatore, referrerPolicy: referer ? 'strict-origin' : 'no-referrer', signal });
    if (passo.rimando) {
      let prossimo;
      try { prossimo = new URL(passo.rimando, u.href); } catch (_) { throw new Error('bad-url'); }
      if (typeof redirectAmmesso === 'function' && !redirectAmmesso(partenza, prossimo)) throw new Error('blocked-redirect');
      corrente = prossimo.href;
      continue;
    }
    // Chi salva un file dice da dove è arrivato davvero, dopo i rimandi.
    try { Object.defineProperty(passo.risposta, 'url', { value: u.href }); } catch (_) {}
    return passo.risposta;
  }
  throw new Error('too-many-redirects');
}

module.exports = {
  perContoDellaScheda,
  refererPerConto,
  politicaDi,
  ricordaPoliticaDocumento,
  politicaDocumento,
  paginaDi,
  stessoSitoWeb,
  _dip: dip,
};
