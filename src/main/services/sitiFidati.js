// I siti di cui l'utente si fida (#967): l'elenco security.safeBrowse.trustedSites, scritto in fila, e l'avviso con
// «Annulla» quando ci entra un sito. Non decide l'avviso: lo tace il TabManager (tabSafebrowse.js), solo sul «sospetto».
// Prove: tests/siti-fidati.spec.mjs, tests/unit/sitiFidati.test.mjs.
'use strict';

const N = require('../../shared/nomiSito.js');

function elencoDi(settings) {
  const l = settings && settings.security && settings.security.safeBrowse && settings.security.safeBrowse.trustedSites;
  return (Array.isArray(l) ? l : []).filter((x) => typeof x === 'string' && x.trim());
}

// «münchen.de», «sites.google.com/view/x»: la voce come si legge, il percorso di una pagina ospitata compreso.
function leggibile(voce) {
  const s = String(voce || '');
  const i = s.indexOf('/');
  return i < 0 ? N.leggibile(s) : N.leggibile(s.slice(0, i)) + s.slice(i);
}

// L'elenco dopo il cambio: chi c'è già non si ripete, chi esce esce per voce intera.
function elencoNuovo(prima, { aggiungi = [], togli = [] } = {}) {
  const via = new Set(togli);
  const dopo = prima.filter((x) => !via.has(x));
  for (const v of aggiungi) if (v && !dopo.includes(v)) dopo.push(v);
  return dopo;
}

// Il magazzino si rilegge e si riscrive intero: le scritture in fila (patterns/chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md).
// La scrittura passa da applySettingsUpdate, così schede, pagine e rilevatore lo sanno subito.
let scrivi = (partial) => require('./handlers').applySettingsUpdate(partial);
let coda = Promise.resolve();
function cambia({ aggiungi = [], togli = [] } = {}) {
  const giro = coda.then(async () => {
    const S = globalThis.SN_STORAGE;
    const prima = elencoDi(await S.getSettings());
    const dopo = elencoNuovo(prima, { aggiungi, togli });
    const entrati = dopo.filter((x) => !prima.includes(x));
    const usciti = prima.filter((x) => !dopo.includes(x));
    if (entrati.length || usciti.length) {
      await scrivi({ security: { safeBrowse: { trustedSites: dopo } } });
    }
    return { entrati, usciti, elenco: dopo };
  });
  coda = giro.catch(() => {});
  return giro;
}

function t(chiave, ...args) {
  try { return globalThis.SN_I18N.t(chiave, ...args); } catch (_) { return chiave; }
}

// L'avviso in basso: il sito ora è fidato, e «Annulla» lo toglie (l'avviso sulla pagina torna).
function avvisa(win, voci) {
  if (!win || win.isDestroyed() || !voci.length) return;
  const testo = t('siti_fidati_fatto', voci.map(leggibile).join(', '));
  const actions = [{ label: t('siti_fidati_annulla'), sitiFidati: { voci, fidato: false } }];
  try { win.webContents.send('shell:toast', { text: testo, opts: { durationSec: 12, key: 'siti-fidati', tipo: 'sito_fidato', actions } }); } catch (_) {}
}

// Un sito entra nell'elenco da un gesto dell'utente (il «Continua», l'«Apri comunque»). In incognito no: la scelta
// resta in quella scheda e non lascia traccia.
async function fidati(voce, { win = null, incognito = false } = {}) {
  if (!voce || incognito) return { ok: true, entrati: [] };
  const r = await cambia({ aggiungi: [voce] });
  avvisa(win, r.entrati);
  return { ok: true, ...r };
}

module.exports = { elencoDi, elencoNuovo, leggibile, cambia, fidati, _usaScrittura: (fn) => { scrivi = fn; } };
