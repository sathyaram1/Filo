// Le icone delle voci rimaste senza copia (salvate o archiviate prima del #1273, un link salvato, una scheda chiusa prima
// che l'icona arrivasse): si chiedono una volta sola, senza cookie, e poi si tengono; quelle nate da una scheda col proxy
// mai. Un data: URL rimasto nei dati diventa una copia, senza rete. Regole: copieIcone.js; prove: tests/unit/copieIcone.test.mjs.

'use strict';

const IconaScheda = require('./iconaScheda');
const Copie = require('./copieIcone');

const IN_PARALLELO = 4;
// L'avvio non aspetta le icone: partono dopo, e una voce nuova da completare si unisce al giro dopo qualche secondo.
const ATTESA_AVVIO_MS = 15000;
const ATTESA_NUOVA_MS = 3000;

const fuoriIncognito = (fn) => { try { return require('../shim/storage').runNormale(fn); } catch (_) { return fn(); } };

// L'indirizzo da chiedere per una voce senza copia, o '' se non se ne chiede nessuno: già tentata (`iconaMancante`),
// nata da una scheda col proxy, o non un sito web. Di una voce di prima si chiede l'icona che la sua pagina dichiarava.
function daChiedere(v) {
  if (!v || Copie.eLocale(v.favicon) || v.proxy || v.iconaMancante) return '';
  if (typeof v.faviconDaChiedere === 'string' && /^https?:\/\//i.test(v.faviconDaChiedere)) return v.faviconDaChiedere;
  try {
    const u = new URL(String(v.url || ''));
    return u.protocol === 'http:' || u.protocol === 'https:' ? `${u.origin}/favicon.ico` : '';
  } catch (_) { return ''; }
}

// Quello che il giro ha letto della voce: se nel frattempo è cambiato, il suo esito non vale più.
const statoIcona = (v) => `${(v && v.favicon) || ''}|${(v && v.faviconDaChiedere) || ''}|${v && v.iconaMancante ? 1 : 0}`;

// Trovata, la voce tiene la copia; mancata, non la si chiede più (salvo la scheda col proxy, che non la chiede comunque).
const esitoIcona = (v, a) => (a
  ? { favicon: a, faviconDaChiedere: undefined, iconaMancante: undefined }
  : { favicon: '', faviconDaChiedere: undefined, iconaMancante: v && v.proxy ? undefined : true });

function crea({
  iconaPer = IconaScheda.iconaPer,
  sessione = () => require('electron').session.defaultSession,
  inLinea = () => require('electron').net.isOnline(),
  salvate = () => globalThis.SN_SAVED_PAGES,
  archivio = () => globalThis.SN_ARCHIVED_TABS,
} = {}) {
  let corsa = null;
  let seguente = null;
  let timer = null;

  async function giro() {
    const S = salvate();
    const A = archivio();
    const gruppi = [[S, S ? await S.list() : [], new Map()], [A, A ? await A.list() : [], new Map()]];
    const perIndirizzo = new Map();
    const online = inLinea();
    for (const [, voci, esiti] of gruppi) {
      for (const v of voci) {
        const prima = statoIcona(v);
        if (/^data:/i.test(typeof v.favicon === 'string' ? v.favicon : '')) {
          esiti.set(v.id, { prima, a: await Copie.conserva(v.favicon) });
          continue;
        }
        const u = daChiedere(v);
        // Un indirizzo di prima di una scheda passata dal proxy non si segue: si toglie, e resta l'icona generica.
        if (!u) { if (v.faviconDaChiedere) esiti.set(v.id, { prima, a: '' }); continue; }
        // Senza rete il tentativo non vale: resta da fare al prossimo giro.
        if (!online) continue;
        if (!perIndirizzo.has(u)) perIndirizzo.set(u, []);
        perIndirizzo.get(u).push({ esiti, id: v.id, prima });
      }
    }
    const coda = [...perIndirizzo.entries()];
    const lavoratore = async () => {
      for (let x = coda.shift(); x; x = coda.shift()) {
        const [u, voci] = x;
        let a = '';
        try {
          const { dato } = await iconaPer(sessione(), [u], { cookie: false });
          a = dato ? await Copie.conserva(dato) : '';
        } catch (_) { a = ''; }
        for (const { esiti, id, prima } of voci) esiti.set(id, { prima, a });
      }
    };
    await Promise.all(Array.from({ length: Math.min(IN_PARALLELO, coda.length) }, lavoratore));
    let cambiate = 0;
    for (const [M, , esiti] of gruppi) if (M && esiti.size) cambiate += await M.aggiornaIcone(esiti);
    return { chieste: perIndirizzo.size, cambiate };
  }

  // Chi chiede mentre un giro è in corso aspetta il giro dopo, che vede anche le voci arrivate nel frattempo.
  function completa() {
    if (corsa) {
      if (!seguente) seguente = corsa.then(() => { seguente = null; return completa(); });
      return seguente;
    }
    corsa = fuoriIncognito(giro).catch(() => ({ chieste: 0, cambiate: 0 })).finally(() => { corsa = null; });
    return corsa;
  }

  function pianifica(ms = ATTESA_NUOVA_MS) {
    if (timer) return;
    timer = setTimeout(() => { timer = null; completa(); }, ms);
    if (timer.unref) timer.unref();
  }

  // All'avvio: prima le icone da completare, poi via i file che nessuna voce nomina più.
  function avvio(ms = ATTESA_AVVIO_MS) {
    setTimeout(() => { completa().then(() => Copie.pulisci()).catch(() => {}); }, ms).unref?.();
  }

  return { completa, pianifica, avvio };
}

module.exports = { crea, daChiedere, statoIcona, esitoIcona, ...crea() };
if (process.env.NODE_ENV === 'test') globalThis.__filoIconeVecchie = module.exports;
