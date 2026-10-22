// La pila delle schede chiuse che Ctrl/Cmd+Shift+T riapre, dalla più recente (#1476). Pura, senza Electron: tabs.js
// le consegna le schede che chiude e riapre quello che lei restituisce; finita la pila si scende nell'archivio.
// Sentinella: tests/unit/schedeChiuse.test.mjs.

// Le più vecchie oltre il tetto restano nell'archivio, e la discesa le ritrova nello stesso ordine.
const TETTO = 500;

const web = (url) => /^https?:\/\//i.test(String(url || ''));

// Una home senza niente dietro né davanti, riaperta, non ridà niente: Chrome fa lo stesso con la sua.
function daRicordare(url, storia) {
  const s = String(url || '');
  if (!s || s === 'about:blank') return false;
  let u = null;
  try { u = new URL(s); } catch (_) { return true; }
  const vuota = u.protocol === 'filo:' && u.hostname === 'newtab' && !u.search;
  return !vuota || !!(storia && (storia.prima.length || storia.dopo.length));
}

// Una voce dell'archivio nella forma della pila: lì il posto nella fila e la cronologia non ci sono.
function daArchivio(e) {
  return {
    url: e.url,
    scroll: typeof e.scrollPosition === 'number' ? e.scrollPosition : null,
    proxy: e.proxy && e.proxy.country ? { country: e.proxy.country, tier: e.proxy.tier || null } : null,
    colore: e.identityColor || null,
  };
}

function crea({ tetto = TETTO } = {}) {
  const pila = [];
  // Gli id d'archivio già riaperti, da qualunque porta: la discesa nell'archivio non li ripropone.
  const riaperte = new Set();

  function togliDove(prova) {
    for (let i = pila.length - 1; i >= 0; i--) if (prova(pila[i])) pila.splice(i, 1);
  }

  function ricorda(voce) {
    pila.push({ ...voce, archivio: null, riaperta: false });
    if (pila.length > tetto) pila.splice(0, pila.length - tetto);
    return pila[pila.length - 1];
  }

  // L'archivio ha rifiutato la scheda (le sue pagine erano state tolte dal filo): la pila non la ridà.
  function archiviata(voce, id) {
    if (!voce) return;
    if (!id) { togliDove((v) => v === voce); return; }
    voce.archivio = id;
    if (voce.riaperta) riaperte.add(id);
  }

  function prendi() {
    const voce = pila.pop() || null;
    if (voce) {
      voce.riaperta = true;
      if (voce.archivio) riaperte.add(voce.archivio);
    }
    return voce;
  }

  function segnaRiaperta(id) {
    if (!id) return;
    riaperte.add(id);
    togliDove((v) => v.archivio === id);
  }

  // Schede cancellate dall'archivio: non tornano nemmeno da qui. `null` = l'archivio svuotato tutto.
  function dimentica(ids) {
    if (ids == null) { pila.length = 0; return; }
    const via = new Set(ids);
    togliDove((v) => v.archivio && via.has(v.archivio));
  }

  // La scheda d'archivio chiusa più di recente che non è già stata riaperta e che si può riaprire com'era.
  function dallArchivio(voci) {
    let scelta = null;
    let quando = -Infinity;
    for (const v of Array.isArray(voci) ? voci : []) {
      if (!v || typeof v.id !== 'string' || riaperte.has(v.id) || v.urlTagliato || !web(v.url)) continue;
      const t = Date.parse(v.closedAt);
      const c = Number.isFinite(t) ? t : -Infinity;
      if (!scelta || c > quando) { scelta = v; quando = c; }
    }
    return scelta;
  }

  return {
    ricorda, archiviata, prendi, segnaRiaperta, dimentica, dallArchivio,
    get quante() { return pila.length; },
  };
}

module.exports = { crea, daRicordare, daArchivio, TETTO };
