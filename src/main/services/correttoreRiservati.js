// Chiavi, password, codici e numeri di carta scritti in un campo non partono verso i modelli del correttore (#1446): al
// loro posto va un segnaposto e il resto si controlla lo stesso. Le forme le riconoscono guardianoStatico.js e urlExfil.js.
// Si cercano nel campo intero, mai pezzo per pezzo. Prove: tests/unit/correttoreRiservati.test.mjs.
'use strict';

const SEGNAPOSTO = '[dato riservato]';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function riservati(testo) {
  const G = globalThis.SN_GUARDIANO_STATICO;
  const X = globalThis.SN_URL_EXFIL;
  const out = [];
  try { if (G && G.segretiNelTesto) out.push(...G.segretiNelTesto(testo)); } catch (_) {}
  try { if (X && X.segretiDetti) out.push(...X.segretiDetti(testo.toLowerCase())); } catch (_) {}
  // Una carta mentre la si scrive: due gruppi da quattro cifre sono già metà numero, e il resto arriva al controllo dopo.
  for (const m of testo.matchAll(GRUPPI_DI_CARTA)) out.push({ valore: m[0].replace(/ /g, '') });
  return out.map((x) => String((x && x.valore) || '')).filter((v) => v.length >= 4);
}
const GRUPPI_DI_CARTA = /(?<![\p{L}\p{N}])\d{4}(?: \d{4})+(?![\p{L}\p{N}])/gu;

// Un numero di carta si scrive anche a gruppi («4111 1111 …»): fra una cifra e l'altra può stare uno spazio o un trattino.
const formaDi = (valore) => new RegExp(/^\d+$/.test(valore) ? valore.split('').map(esc).join('[\\s-]?') : esc(valore), 'gi');
const valoriDi = (testo) => [...new Set(riservati(testo))].sort((a, b) => b.length - a.length);

function oscura(testo, valori = null) {
  let v = String(testo == null ? '' : testo);
  if (!v.trim()) return v;
  for (const valore of valori || valoriDi(v)) v = v.replace(formaDi(valore), SEGNAPOSTO);
  return v;
}

// I pezzi contigui del campo (prima, nuovo, dopo), oscurati sul campo intero: la parola che presenta una password, o
// metà di un numero di carta, può stare in un pezzo diverso dal valore, o fuori dai pezzi. `campo` e `campoDa` (dove
// comincia il primo pezzo) li manda la pagina; se non tornano coi pezzi vale il loro testo unito.
function pezziOscurati(pezzi, campo, campoDa) {
  const unito = pezzi.join('');
  const daCampo = typeof campo === 'string' && Number.isInteger(campoDa) && campoDa >= 0
    && campo.slice(campoDa, campoDa + unito.length) === unito;
  const base = daCampo ? campo : unito;
  const scarto = daCampo ? campoDa : 0;
  // Anche pezzo per pezzo: due pezzi incollati possono fondere due numeri in uno che non è più una carta.
  const valori = [...new Set([base, ...pezzi].flatMap(valoriDi))].sort((x, y) => y.length - x.length);
  const coperti = [];
  for (const valore of valori) for (const m of base.matchAll(formaDi(valore))) coperti.push([m.index - scarto, m.index - scarto + m[0].length]);
  let a = 0;
  const out = pezzi.map((pezzo) => {
    const da = a;
    a += pezzo.length;
    const qui = coperti.map(([x, y]) => [Math.max(x, da) - da, Math.min(y, a) - da]).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
    const uniti = [];
    for (const [x, y] of qui) {
      const ultimo = uniti[uniti.length - 1];
      if (ultimo && x <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], y); else uniti.push([x, y]);
    }
    let v = '';
    let i = 0;
    for (const [x, y] of uniti) { v += pezzo.slice(i, x) + SEGNAPOSTO; i = y; }
    return v + pezzo.slice(i);
  });
  return { pezzi: out, valori };
}

// Le parti di una richiesta del correttore che portano testo: quello del campo, i candidati, la pagina intorno. Il campo
// intero serve solo qui: non parte.
function richiestaSenzaRiservati(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = { ...p };
  delete out.campo;
  delete out.campoDa;
  const chiavi = ['prima', 'nuovo', 'dopo'];
  const { pezzi, valori } = pezziOscurati(chiavi.map((k) => (typeof p[k] === 'string' ? p[k] : '')), p.campo, p.campoDa);
  chiavi.forEach((k, i) => { if (typeof p[k] === 'string') out[k] = pezzi[i]; });
  const delCampo = (t) => oscura(oscura(t, valori));
  if (Array.isArray(p.candidati)) out.candidati = p.candidati.map((c) => (c && typeof c === 'object' ? { ...c, pezzo: delCampo(c.pezzo) } : c));
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

module.exports = { SEGNAPOSTO, oscura, pezziOscurati, richiestaSenzaRiservati };
