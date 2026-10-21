// Chiavi, password, codici e numeri di carta scritti in un campo non partono verso i modelli del correttore (#1446): al
// loro posto va un segnaposto e il resto si controlla lo stesso. Le forme le riconoscono guardianoStatico.js e urlExfil.js.
// Prove: tests/unit/correttoreRiservati.test.mjs.
'use strict';

const SEGNAPOSTO = '[dato riservato]';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function riservati(testo) {
  const G = globalThis.SN_GUARDIANO_STATICO;
  const X = globalThis.SN_URL_EXFIL;
  const out = [];
  try { if (G && G.segretiNelTesto) out.push(...G.segretiNelTesto(testo)); } catch (_) {}
  try { if (X && X.segretiDetti) out.push(...X.segretiDetti(testo.toLowerCase())); } catch (_) {}
  return out.map((x) => String((x && x.valore) || '')).filter((v) => v.length >= 4);
}

// Un numero di carta si scrive anche a gruppi («4111 1111 …»): fra una cifra e l'altra può stare uno spazio o un trattino.
function oscura(testo) {
  let v = String(testo == null ? '' : testo);
  if (!v.trim()) return v;
  const valori = [...new Set(riservati(v))].sort((a, b) => b.length - a.length);
  for (const valore of valori) {
    const forma = /^\d+$/.test(valore) ? valore.split('').map(esc).join('[\\s-]?') : esc(valore);
    v = v.replace(new RegExp(forma, 'gi'), SEGNAPOSTO);
  }
  return v;
}

// Le parti di una richiesta del correttore che portano testo: quello del campo, i candidati, la pagina intorno.
function richiestaSenzaRiservati(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = { ...p };
  for (const k of ['prima', 'nuovo', 'dopo']) if (typeof p[k] === 'string') out[k] = oscura(p[k]);
  if (Array.isArray(p.candidati)) out.candidati = p.candidati.map((c) => (c && typeof c === 'object' ? { ...c, pezzo: oscura(c.pezzo) } : c));
  if (p.luogo && typeof p.luogo === 'object') {
    out.luogo = { ...p.luogo };
    for (const k of ['titolo', 'conversazione']) if (typeof p.luogo[k] === 'string') out.luogo[k] = oscura(p.luogo[k]);
  }
  if (p.contesto && typeof p.contesto === 'object') {
    out.contesto = { ...p.contesto };
    for (const k of ['prima', 'dopo']) if (typeof p.contesto[k] === 'string') out.contesto[k] = oscura(p.contesto[k]);
  }
  return out;
}

module.exports = { SEGNAPOSTO, oscura, richiestaSenzaRiservati };
