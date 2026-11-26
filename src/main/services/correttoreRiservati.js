// Chiavi, password, codici e numeri di carta scritti in un campo non partono verso i modelli del correttore (#1446): al
// loro posto va un segnaposto e il resto si controlla lo stesso. Le forme le riconoscono guardianoStatico.js, urlExfil.js
// e riservatiNelTesto.js (quelle scritte a mano, le stesse del pavimento). Prove: tests/unit/correttoreRiservati.test.mjs.
'use strict';

const SEGNAPOSTO = '[dato riservato]';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const GRUPPI_DI_CARTA = /(?<![\p{L}\p{N}])\d{4}(?: \d{4})+(?![\p{L}\p{N}])/gu;
// Il testo sopra il campo che si legge: la domanda a cui il campo risponde sta lì (riservatiNelTesto.js, richiestaAperta).
const SOPRA_MAX = 1500;

const RT = () => globalThis.SN_RISERVATI_TESTO || require('../../shared/riservatiNelTesto.js');
const PAV = () => globalThis.SN_PAVIMENTO || require('../../shared/pavimento.js');

function riservati(testo) {
  const G = globalThis.SN_GUARDIANO_STATICO;
  const X = globalThis.SN_URL_EXFIL;
  const out = [];
  const l = testo.toLowerCase();
  try { if (G && G.segretiNelTesto) out.push(...G.segretiNelTesto(testo)); } catch (_) {}
  try { if (X && X.segretiDetti) out.push(...X.segretiDetti(l)); } catch (_) {}
  // Una carta mentre la si scrive: due gruppi da quattro cifre sono già metà numero, e il resto arriva al controllo dopo.
  for (const m of testo.matchAll(GRUPPI_DI_CARTA)) out.push({ valore: m[0].replace(/ /g, '') });
  const valori = [...RT().lunghi(out), ...RT().trova(testo)];
  // Una password con gli spazi fra virgolette vale intera, come nel pavimento.
  try { valori.push(...RT().lunghi(PAV().interiFraVirgolette(testo, valori))); } catch (_) {}
  return valori;
}

// Un numero di carta si scrive anche a gruppi («4111 1111 …»): fra una cifra e l'altra può stare uno spazio o un trattino.
// Una parola di sole lettere vale intera: il «camera» di una risposta non tocca «cameraman».
function formaDi(valore) {
  if (/^\d+$/.test(valore)) return new RegExp(valore.split('').join('[\\s-]?'), 'gi');
  if (/^\p{L}+$/u.test(valore)) return new RegExp(`(?<![\\p{L}\\p{N}])${valore}(?![\\p{L}\\p{N}])`, 'giu');
  return new RegExp(esc(valore), 'gi');
}
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
function pezziOscurati(pezzi, campo, campoDa, sopra = '') {
  const R = RT();
  const unito = pezzi.join('');
  const daCampo = typeof campo === 'string' && Number.isInteger(campoDa) && campoDa >= 0
    && campo.slice(campoDa, campoDa + unito.length) === unito;
  const base = daCampo ? campo : unito;
  const scarto = daCampo ? campoDa : 0;
  // Sopra il campo stanno la domanda a cui risponde e il messaggio che ha già detto il dato.
  const s = typeof sopra === 'string' ? sopra.slice(-SOPRA_MAX) : '';
  const aperta = s ? R.richiestaAperta(s) : null;
  // Anche pezzo per pezzo: due pezzi incollati possono fondere due numeri in uno che non è più una carta.
  const valori = [...new Set([
    ...[base, ...pezzi].flatMap(valoriDi),
    ...(s ? valoriDi(s) : []),
    ...(aperta ? R.lunghi(R.valoriRisposta(R.minuscolo(base.slice(0, R.RISPOSTA_MAX)),aperta.tipo, aperta.chiesta, aperta.data)) : []),
  ])].sort((x, y) => y.length - x.length);
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
// intero e il testo sopra servono solo qui: non partono.
function richiestaSenzaRiservati(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const out = { ...p };
  delete out.campo;
  delete out.campoDa;
  delete out.sopra;
  // Il testo sopra lo legge la pagina a ogni richiesta; senza, vale quello che parte con lei.
  const sopra = [p.sopra, p.contesto && p.contesto.prima, p.luogo && p.luogo.conversazione].find((t) => typeof t === 'string') || '';
  const chiavi = ['prima', 'nuovo', 'dopo'];
  const { pezzi, valori } = pezziOscurati(chiavi.map((k) => (typeof p[k] === 'string' ? p[k] : '')), p.campo, p.campoDa, sopra);
  chiavi.forEach((k, i) => { if (typeof p[k] === 'string') out[k] = pezzi[i]; });
  const delCampo = (t) => oscura(oscura(t, valori));
  if (Array.isArray(p.candidati)) out.candidati = p.candidati.map((c) => (c && typeof c === 'object' ? { ...c, pezzo: delCampo(c.pezzo) } : c));
  if (p.luogo && typeof p.luogo === 'object') {
    out.luogo = { ...p.luogo };
    for (const k of ['titolo', 'conversazione']) if (typeof p.luogo[k] === 'string') out.luogo[k] = delCampo(p.luogo[k]);
  }
  if (p.contesto && typeof p.contesto === 'object') {
    out.contesto = { ...p.contesto };
    for (const k of ['prima', 'dopo']) if (typeof p.contesto[k] === 'string') out.contesto[k] = delCampo(p.contesto[k]);
  }
  // Le date da giudicare portano il pezzo del campo e le righe della pagina (o del titolo) che dicono l'anno.
  const testo = (t) => (typeof t === 'string' ? delCampo(t) : '');
  if (Array.isArray(p.date)) {
    out.date = p.date.filter((d) => d && typeof d === 'object').map((d) => ({
      ...d, pezzo: testo(d.pezzo),
      anni: (Array.isArray(d.anni) ? d.anni : []).map((a) => (a && typeof a === 'object' ? { ...a, riga: testo(a.riga) } : a)),
    }));
  }
  return out;
}

const formeLibere = (testo) => RT().formeLibere(testo);

module.exports = { SEGNAPOSTO, oscura, pezziOscurati, richiestaSenzaRiservati, formeLibere };
